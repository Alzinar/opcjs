/* Minimal open62541 reference server used for opcjs-client interop testing.
 *
 * Exposes a single writable Int32 variable ("Integer") under the Objects
 * folder, in the custom namespace "http://opcjs.dev/UA/RefServer/" (mirrors
 * ref/uaNet/RefServer's node tree). Listens on both opc.tcp:// (native OPC UA
 * transport) and opc.wss:// (libwebsockets-backed WebSocket transport, the
 * only one opcjs-client speaks), using a self-signed certificate persisted
 * under the shared ref/ certificate location (see ref/README.md#certificates).
 */

#include <open62541/server.h>
#include <open62541/server_config_default.h>
#include <open62541/plugin/create_certificate.h>
#include <open62541/plugin/log_stdout.h>

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include <pthread.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

#define TCP_PORT 62545
#define WSS_PORT 62546
/* Test-only, localhost-only control listener used by ref/opcjs/RefClient/tests/open62541.test.ts
 * (Session Client Detect Shutdown conformance unit) — not part of the OPC UA protocol. */
#define CONTROL_PORT 62551
/* libwebsockets binds the vhost "iface" directly to a numeric IP or network
 * device name (no DNS resolution) — "localhost" fails with "DOESN'T EXIST". */
#define WSS_ENDPOINT_URL "opc.wss://127.0.0.1:" _STR(WSS_PORT) "/RefServer"
#define _STR(x) __STR(x)
#define __STR(x) #x

/* Assumes the process is started with its cwd set to this source directory
 * (ref/open62541/RefServer), matching ref/uaNet/RefServer's convention. */
#define PKI_DIR "../../../tmp/ref/open62541/RefServer/pki/own"

/* Must match the URI SubjectAltName baked into the self-signed certificate
 * (see ensureOwnCertificate) — the client validates that the server's
 * advertised ApplicationDescription.applicationUri matches the certificate. */
#define APPLICATION_URI "urn:opcjs:ref:open62541:RefServer"

static volatile UA_Boolean running = true;

/* Flipped by the control-thread listener below, read by readServerStatusOverride() (invoked on
 * the main server thread while handling Read requests) — a plain flag toggle, fully decoupled
 * from open62541's own real shutdown machinery (UA_Server_run's endTime), so simulating a
 * shutdown here never actually terminates this reference server. */
static volatile sig_atomic_t g_simulateShutdown = 0;
static UA_DateTime g_serverStartTime;

static void stopHandler(int sign) {
    (void) sign;
    running = false;
}

/* Overrides the standard ServerStatus (ns=0;i=2256) read callback so this reference server can
 * report ServerState.Shutdown on demand, purely for the Session Client Detect Shutdown ref test —
 * see the control-thread listener (controlServerThread) and g_simulateShutdown above. */
static UA_StatusCode
readServerStatusOverride(UA_Server *server, const UA_NodeId *sessionId, void *sessionContext,
                          const UA_NodeId *nodeId, void *nodeContext, UA_Boolean sourceTimestamp,
                          const UA_NumericRange *range, UA_DataValue *value) {
    (void) sessionId; (void) sessionContext; (void) nodeId; (void) nodeContext;

    if(range) {
        value->hasStatus = true;
        value->status = UA_STATUSCODE_BADINDEXRANGEINVALID;
        return UA_STATUSCODE_GOOD;
    }

    UA_ServerStatusDataType *status = UA_ServerStatusDataType_new();
    if(!status)
        return UA_STATUSCODE_BADOUTOFMEMORY;

    UA_DateTime now = UA_DateTime_now();
    status->startTime = g_serverStartTime;
    status->currentTime = now;
    status->state = g_simulateShutdown ? UA_SERVERSTATE_SHUTDOWN : UA_SERVERSTATE_RUNNING;
    status->secondsTillShutdown = g_simulateShutdown ? 3600 : 0;
    UA_BuildInfo_copy(&UA_Server_getConfig(server)->buildInfo, &status->buildInfo);

    value->value.data = status;
    value->value.type = &UA_TYPES[UA_TYPES_SERVERSTATUSDATATYPE];
    value->hasValue = true;
    if(sourceTimestamp) {
        value->hasSourceTimestamp = true;
        value->sourceTimestamp = now;
    }
    return UA_STATUSCODE_GOOD;
}

/* Accepts one connection at a time on 127.0.0.1:CONTROL_PORT, reads a single line ("Shutdown" or
 * "Running"), flips g_simulateShutdown accordingly, and replies "OK\n". Runs on its own thread;
 * only ever touches the plain flag above, never calls into the (not thread-safe) UA_Server API. */
static void *controlServerThread(void *arg) {
    (void) arg;
    int listenFd = socket(AF_INET, SOCK_STREAM, 0);
    if(listenFd < 0)
        return NULL;

    int reuse = 1;
    setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");
    addr.sin_port = htons(CONTROL_PORT);

    if(bind(listenFd, (struct sockaddr *) &addr, sizeof(addr)) < 0 || listen(listenFd, 4) < 0) {
        close(listenFd);
        return NULL;
    }

    while(running) {
        int connFd = accept(listenFd, NULL, NULL);
        if(connFd < 0)
            continue;

        char buf[64];
        ssize_t n = read(connFd, buf, sizeof(buf) - 1);
        if(n > 0) {
            buf[n] = '\0';
            const char *reply = "ERROR unknown command\n";
            if(strncmp(buf, "Shutdown", 8) == 0) {
                g_simulateShutdown = 1;
                reply = "OK\n";
            } else if(strncmp(buf, "Running", 7) == 0) {
                g_simulateShutdown = 0;
                reply = "OK\n";
            }
            (void) write(connFd, reply, strlen(reply));
        }
        close(connFd);
    }

    close(listenFd);
    return NULL;
}

/* Recursive "mkdir -p", since the shared tmp/ pki path is several levels deep
 * and may not exist yet on first run. */
static void makeDirs(const char *path) {
    char buf[1024];
    snprintf(buf, sizeof(buf), "%s", path);
    for(char *p = buf + 1; *p; p++) {
        if(*p == '/') {
            *p = '\0';
            mkdir(buf, 0700);
            *p = '/';
        }
    }
    mkdir(buf, 0700);
}

static UA_ByteString loadFile(const char *path) {
    UA_ByteString content = UA_BYTESTRING_NULL;
    FILE *fp = fopen(path, "rb");
    if(!fp)
        return content;

    fseek(fp, 0, SEEK_END);
    long size = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if(size > 0) {
        content.data = (UA_Byte *) UA_malloc((size_t) size);
        if(content.data) {
            content.length = (size_t) size;
            if(fread(content.data, 1, content.length, fp) != content.length)
                UA_ByteString_clear(&content);
        }
    }
    fclose(fp);
    return content;
}

static UA_StatusCode saveFile(const char *path, const UA_ByteString content) {
    FILE *fp = fopen(path, "wb");
    if(!fp)
        return UA_STATUSCODE_BADINTERNALERROR;
    size_t written = fwrite(content.data, 1, content.length, fp);
    fclose(fp);
    return written == content.length ? UA_STATUSCODE_GOOD : UA_STATUSCODE_BADINTERNALERROR;
}

/* Loads the persisted self-signed certificate/key from the shared PKI
 * directory, generating and persisting a new one on first run. */
static UA_StatusCode ensureOwnCertificate(UA_ByteString *certificate, UA_ByteString *privateKey) {
    makeDirs(PKI_DIR);
    char certPath[1024], keyPath[1024];
    snprintf(certPath, sizeof(certPath), "%s/cert.der", PKI_DIR);
    snprintf(keyPath, sizeof(keyPath), "%s/key.der", PKI_DIR);

    *certificate = loadFile(certPath);
    *privateKey = loadFile(keyPath);
    if(certificate->length > 0 && privateKey->length > 0)
        return UA_STATUSCODE_GOOD;

    UA_ByteString_clear(certificate);
    UA_ByteString_clear(privateKey);

    UA_String subject[3] = {
        UA_STRING_STATIC("C=DE"),
        UA_STRING_STATIC("O=opcjs"),
        UA_STRING_STATIC("CN=Open62541RefServer@localhost"),
    };
    UA_String subjectAltName[2] = {
        UA_STRING_STATIC("DNS:localhost"),
        UA_STRING_STATIC("URI:" APPLICATION_URI),
    };
    UA_StatusCode res = UA_CreateCertificate(
        UA_Log_Stdout, subject, 3, subjectAltName, 2,
        UA_CERTIFICATEFORMAT_DER, NULL, privateKey, certificate);
    if(res != UA_STATUSCODE_GOOD)
        return res;

    saveFile(certPath, *certificate);
    saveFile(keyPath, *privateKey);
    return UA_STATUSCODE_GOOD;
}

/* Adds the "Integer" variable node under the Objects folder, in a custom
 * namespace (mirrors ref/uaNet/RefServer's node tree for cross-framework
 * interop tests). Returns the assigned NodeId via *outNodeId. */
static UA_StatusCode addIntegerVariable(UA_Server *server, UA_NodeId *outNodeId) {
    UA_UInt16 nsIdx = UA_Server_addNamespace(server, "http://opcjs.dev/UA/RefServer/");

    UA_VariableAttributes attr = UA_VariableAttributes_default;
    UA_Int32 initialValue = 42;
    UA_Variant_setScalar(&attr.value, &initialValue, &UA_TYPES[UA_TYPES_INT32]);
    attr.displayName = UA_LOCALIZEDTEXT("en-US", "Integer");
    attr.dataType = UA_TYPES[UA_TYPES_INT32].typeId;
    attr.accessLevel = UA_ACCESSLEVELMASK_READ | UA_ACCESSLEVELMASK_WRITE;

    UA_NodeId integerNodeId = UA_NODEID_STRING(nsIdx, "Integer");
    UA_QualifiedName browseName = UA_QUALIFIEDNAME(nsIdx, "Integer");
    *outNodeId = UA_NODEID_STRING_ALLOC(nsIdx, "Integer");
    return UA_Server_addVariableNode(
        server, integerNodeId, UA_NS0ID(OBJECTSFOLDER), UA_NS0ID(ORGANIZES),
        browseName, UA_NODEID_NULL, attr, NULL, NULL);
}

/* Increments the Integer variable every time this repeated callback fires, so
 * subscribing clients observe a changing value without a client-initiated Write. */
static void incrementInteger(UA_Server *server, void *data) {
    UA_NodeId *nodeId = (UA_NodeId *) data;
    UA_Variant currentValue;
    UA_Variant_init(&currentValue);
    UA_StatusCode res = UA_Server_readValue(server, *nodeId, &currentValue);
    if(res != UA_STATUSCODE_GOOD || !UA_Variant_hasScalarType(&currentValue, &UA_TYPES[UA_TYPES_INT32])) {
        UA_Variant_clear(&currentValue);
        return;
    }

    UA_Int32 nextValue = *(UA_Int32 *) currentValue.data + 1;
    UA_Variant_clear(&currentValue);

    UA_Variant newValue;
    UA_Variant_init(&newValue);
    UA_Variant_setScalar(&newValue, &nextValue, &UA_TYPES[UA_TYPES_INT32]);
    UA_Server_writeValue(server, *nodeId, newValue);
}


int main(void) {
    signal(SIGINT, stopHandler);
    signal(SIGTERM, stopHandler);

    UA_ByteString certificate = UA_BYTESTRING_NULL;
    UA_ByteString privateKey = UA_BYTESTRING_NULL;
    UA_StatusCode res = ensureOwnCertificate(&certificate, &privateKey);
    if(res != UA_STATUSCODE_GOOD) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Could not create the self-signed certificate: %s", UA_StatusCode_name(res));
        return EXIT_FAILURE;
    }

    UA_Server *server = UA_Server_new();
    UA_ServerConfig *config = UA_Server_getConfig(server);

    res = UA_ServerConfig_setDefaultWithSecurityPolicies(
        config, TCP_PORT, &certificate, &privateKey, NULL, 0, NULL, 0, NULL, 0);
    if(res != UA_STATUSCODE_GOOD) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Could not configure the server: %s", UA_StatusCode_name(res));
        UA_ByteString_clear(&certificate);
        UA_ByteString_clear(&privateKey);
        UA_Server_delete(server);
        return EXIT_FAILURE;
    }

    /* Must match the certificate's URI SubjectAltName (see ensureOwnCertificate) —
     * opcjs-client rejects the server certificate otherwise. */
    UA_String_clear(&config->applicationDescription.applicationUri);
    config->applicationDescription.applicationUri = UA_String_fromChars(APPLICATION_URI);

    /* opc.wss:// listener — the only transport opcjs-client speaks. Takes
     * ownership of certificate/privateKey (unlike the const-pointer function
     * above, which copies them internally). */
    config->webSocketEnabled = true;
    config->webSocketCertificate = certificate;
    config->webSocketPrivateKey = privateKey;
    certificate = UA_BYTESTRING_NULL;
    privateKey = UA_BYTESTRING_NULL;

    const UA_String wssUrl = UA_STRING(WSS_ENDPOINT_URL);
    res = UA_Array_appendCopy((void **) &config->serverUrls, &config->serverUrlsSize,
                              &wssUrl, &UA_TYPES[UA_TYPES_STRING]);
    if(res != UA_STATUSCODE_GOOD) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Could not configure the WebSocket endpoint: %s", UA_StatusCode_name(res));
        UA_Server_delete(server);
        return EXIT_FAILURE;
    }

    UA_NodeId integerNodeId;
    res = addIntegerVariable(server, &integerNodeId);
    if(res != UA_STATUSCODE_GOOD) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Could not add the Integer variable: %s", UA_StatusCode_name(res));
        UA_Server_delete(server);
        return EXIT_FAILURE;
    }

    UA_UInt64 incrementCallbackId = 0;
    UA_Server_addRepeatedCallback(server, incrementInteger, &integerNodeId, 200, &incrementCallbackId);

    /* Session Client Detect Shutdown ref test hook (see readServerStatusOverride/
     * controlServerThread above): override the standard ServerStatus read callback so this
     * server can report ServerState.Shutdown on demand, then start the control listener that
     * flips it. */
    g_serverStartTime = UA_DateTime_now();
    UA_CallbackValueSource statusOverride = { readServerStatusOverride, NULL };
    UA_Server_setVariableNode_callbackValueSource(server, UA_NS0ID(SERVER_SERVERSTATUS), statusOverride);

    pthread_t controlThread;
    pthread_create(&controlThread, NULL, controlServerThread, NULL);
    pthread_detach(controlThread);

    UA_LOG_INFO(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                "Server started. opc.tcp://localhost:%d/RefServer and " WSS_ENDPOINT_URL, TCP_PORT);
    fflush(stdout);

    UA_StatusCode runRes = UA_Server_run(server, &running);

    UA_Server_delete(server);
    return runRes == UA_STATUSCODE_GOOD ? EXIT_SUCCESS : EXIT_FAILURE;
}
