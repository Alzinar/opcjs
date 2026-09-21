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

#define TCP_PORT 62545
#define WSS_PORT 62546
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

static void stopHandler(int sign) {
    (void) sign;
    running = false;
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
 * interop tests). */
static UA_StatusCode addIntegerVariable(UA_Server *server) {
    UA_UInt16 nsIdx = UA_Server_addNamespace(server, "http://opcjs.dev/UA/RefServer/");

    UA_VariableAttributes attr = UA_VariableAttributes_default;
    UA_Int32 initialValue = 42;
    UA_Variant_setScalar(&attr.value, &initialValue, &UA_TYPES[UA_TYPES_INT32]);
    attr.displayName = UA_LOCALIZEDTEXT("en-US", "Integer");
    attr.dataType = UA_TYPES[UA_TYPES_INT32].typeId;
    attr.accessLevel = UA_ACCESSLEVELMASK_READ | UA_ACCESSLEVELMASK_WRITE;

    UA_NodeId integerNodeId = UA_NODEID_STRING(nsIdx, "Integer");
    UA_QualifiedName browseName = UA_QUALIFIEDNAME(nsIdx, "Integer");
    return UA_Server_addVariableNode(
        server, integerNodeId, UA_NS0ID(OBJECTSFOLDER), UA_NS0ID(ORGANIZES),
        browseName, UA_NODEID_NULL, attr, NULL, NULL);
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

    res = addIntegerVariable(server);
    if(res != UA_STATUSCODE_GOOD) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Could not add the Integer variable: %s", UA_StatusCode_name(res));
        UA_Server_delete(server);
        return EXIT_FAILURE;
    }

    UA_LOG_INFO(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                "Server started. opc.tcp://localhost:%d/RefServer and " WSS_ENDPOINT_URL, TCP_PORT);
    fflush(stdout);

    UA_StatusCode runRes = UA_Server_run(server, &running);

    UA_Server_delete(server);
    return runRes == UA_STATUSCODE_GOOD ? EXIT_SUCCESS : EXIT_FAILURE;
}
