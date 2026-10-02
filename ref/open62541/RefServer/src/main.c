/* Minimal open62541 reference server used for opcjs-client interop testing.
 *
 * Exposes the address space shared by all RefServers (see "Common address space" in
 * ref/README.md) under the Objects folder, in the custom namespace
 * "http://opcjs.dev/UA/RefServer/" (mirrors ref/uaNet/RefServer's node tree). Listens on both opc.tcp:// (native OPC UA
 * transport) and opc.wss:// (libwebsockets-backed WebSocket transport, the
 * only one opcjs-client speaks), using a self-signed certificate persisted
 * under the shared ref/ certificate location (see ref/README.md#certificates).
 */

#include <open62541/server.h>
#include <open62541/server_config_default.h>
#include <open62541/plugin/accesscontrol_default.h>
#include <open62541/plugin/create_certificate.h>
#include <open62541/plugin/log_stdout.h>

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include <pthread.h>
#include <stdbool.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

#define TCP_PORT 62545
#define WSS_PORT 62546
/* Test-only, localhost-only control listener used by ref/opcjs/RefClientNode/tests/open62541.test.ts
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

/* Index of the custom namespace "http://opcjs.dev/UA/RefServer/", set by addIntegerVariable. */
static UA_UInt16 g_ns;

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

/* ---- Control channel -------------------------------------------------------------------
 * Test-only, localhost-only, line-based raw-TCP protocol shared by all RefServers (see "Control
 * channel" in ref/README.md). Runs on its own thread, so it only calls UA_THREADSAFE server APIs
 * (this build uses UA_MULTITHREADING=100) or touches plain flags / mutex-protected tables. */

#define MAX_TRACKED 256

static UA_Server *g_server;
static pthread_mutex_t g_trackLock = PTHREAD_MUTEX_INITIALIZER;
static UA_UInt32 g_channelIds[MAX_TRACKED];
static size_t g_channelCount = 0;
static UA_NodeId g_sessionIds[MAX_TRACKED];
static size_t g_sessionCount = 0;

/* open62541 has no API to enumerate SecureChannels/Sessions, so track them from the server's
 * notifications. */
static void trackNotification(UA_Server *server, UA_ApplicationNotificationType type,
                              const UA_KeyValueMap payload) {
    (void) server;
    pthread_mutex_lock(&g_trackLock);

    if(type == UA_APPLICATIONNOTIFICATIONTYPE_SECURECHANNEL_OPENED ||
       type == UA_APPLICATIONNOTIFICATIONTYPE_SECURECHANNEL_CLOSED) {
        const UA_UInt32 *id = (const UA_UInt32 *)
            UA_KeyValueMap_getScalar(&payload, UA_QUALIFIEDNAME(0, "securechannel-id"), &UA_TYPES[UA_TYPES_UINT32]);
        if(id) {
            size_t i = 0;
            while(i < g_channelCount && g_channelIds[i] != *id)
                i++;
            if(type == UA_APPLICATIONNOTIFICATIONTYPE_SECURECHANNEL_OPENED) {
                if(i == g_channelCount && g_channelCount < MAX_TRACKED)
                    g_channelIds[g_channelCount++] = *id;
            } else if(i < g_channelCount) {
                g_channelIds[i] = g_channelIds[--g_channelCount];
            }
        }
    } else if(type == UA_APPLICATIONNOTIFICATIONTYPE_SESSION_CREATED ||
              type == UA_APPLICATIONNOTIFICATIONTYPE_SESSION_CLOSED) {
        const UA_NodeId *id = (const UA_NodeId *)
            UA_KeyValueMap_getScalar(&payload, UA_QUALIFIEDNAME(0, "session-id"), &UA_TYPES[UA_TYPES_NODEID]);
        if(id) {
            size_t i = 0;
            while(i < g_sessionCount && !UA_NodeId_equal(&g_sessionIds[i], id))
                i++;
            if(type == UA_APPLICATIONNOTIFICATIONTYPE_SESSION_CREATED) {
                if(i == g_sessionCount && g_sessionCount < MAX_TRACKED)
                    UA_NodeId_copy(id, &g_sessionIds[g_sessionCount++]);
            } else if(i < g_sessionCount) {
                UA_NodeId_clear(&g_sessionIds[i]);
                g_sessionIds[i] = g_sessionIds[--g_sessionCount];
            }
        }
    }

    pthread_mutex_unlock(&g_trackLock);
}

/* Executes one control-protocol line and writes the reply ("OK[ payload]\n" or "ERROR ...\n"). */
static void executeCommand(const char *line, char *reply, size_t replySize) {
    snprintf(reply, replySize, "ERROR unknown command\n");

    if(strncmp(line, "Shutdown", 8) == 0) {
        g_simulateShutdown = 1;
        snprintf(reply, replySize, "OK\n");
    } else if(strncmp(line, "Running", 7) == 0) {
        g_simulateShutdown = 0;
        snprintf(reply, replySize, "OK\n");
    } else if(strcmp(line, "SessionCount") == 0) {
        UA_ServerStatistics statistics = UA_Server_getStatistics(g_server);
        snprintf(reply, replySize, "OK %zu\n", statistics.ss.currentSessionCount);
    } else if(strncmp(line, "AddNamespace ", 13) == 0 && line[13] != '\0') {
        snprintf(reply, replySize, "OK %u\n", (unsigned) UA_Server_addNamespace(g_server, line + 13));
    } else if(strncmp(line, "SetMaxSessions ", 15) == 0 && atoi(line + 15) > 0) {
        UA_Server_getConfig(g_server)->maxSessions = (UA_UInt16) atoi(line + 15);
        snprintf(reply, replySize, "OK\n");
    } else if(strncmp(line, "SetMaxSessionTimeout ", 21) == 0 && atof(line + 21) > 0) {
        UA_Server_getConfig(g_server)->maxSessionTimeout = atof(line + 21);
        snprintf(reply, replySize, "OK\n");
    } else if(strcmp(line, "DropConnections") == 0) {
        /* Copy first: closing a channel fires a notification that locks g_trackLock. */
        UA_UInt32 channelIds[MAX_TRACKED];
        pthread_mutex_lock(&g_trackLock);
        size_t count = g_channelCount;
        memcpy(channelIds, g_channelIds, count * sizeof(UA_UInt32));
        pthread_mutex_unlock(&g_trackLock);
        for(size_t i = 0; i < count; i++)
            UA_Server_closeSecureChannel(g_server, channelIds[i], UA_SHUTDOWNREASON_CLOSE);
        snprintf(reply, replySize, "OK\n");
    } else if(strcmp(line, "CloseSessions") == 0) {
        UA_NodeId sessionIds[MAX_TRACKED];
        pthread_mutex_lock(&g_trackLock);
        size_t count = g_sessionCount;
        for(size_t i = 0; i < count; i++)
            UA_NodeId_copy(&g_sessionIds[i], &sessionIds[i]);
        pthread_mutex_unlock(&g_trackLock);
        for(size_t i = 0; i < count; i++) {
            UA_Server_closeSession(g_server, &sessionIds[i]);
            UA_NodeId_clear(&sessionIds[i]);
        }
        snprintf(reply, replySize, "OK\n");
    }
}

/* Accepts one connection at a time on 127.0.0.1:CONTROL_PORT, reads a single line, executes it
 * and replies. */
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

        char buf[512];
        ssize_t n = read(connFd, buf, sizeof(buf) - 1);
        if(n > 0) {
            buf[n] = '\0';
            while(n > 0 && (buf[n - 1] == '\n' || buf[n - 1] == '\r'))
                buf[--n] = '\0';
            char reply[128];
            executeCommand(buf, reply, sizeof(reply));
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
    g_ns = nsIdx;

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

/* Adds the writable "Int64Array" variable (Int64[]) next to "Integer", used by the
 * read/write-array interop tests. */
static UA_StatusCode addInt64ArrayVariable(UA_Server *server) {
    UA_UInt16 nsIdx = UA_Server_addNamespace(server, "http://opcjs.dev/UA/RefServer/");

    UA_VariableAttributes attr = UA_VariableAttributes_default;
    UA_Int64 initialValue[1] = {0};
    UA_Variant_setArray(&attr.value, initialValue, 1, &UA_TYPES[UA_TYPES_INT64]);
    attr.displayName = UA_LOCALIZEDTEXT("en-US", "Int64Array");
    attr.dataType = UA_TYPES[UA_TYPES_INT64].typeId;
    attr.valueRank = UA_VALUERANK_ONE_DIMENSION;
    UA_UInt32 arrayDimensions[1] = {0};
    attr.arrayDimensionsSize = 1;
    attr.arrayDimensions = arrayDimensions;
    attr.accessLevel = UA_ACCESSLEVELMASK_READ | UA_ACCESSLEVELMASK_WRITE;

    return UA_Server_addVariableNode(
        server, UA_NODEID_STRING(nsIdx, "Int64Array"), UA_NS0ID(OBJECTSFOLDER), UA_NS0ID(ORGANIZES),
        UA_QUALIFIEDNAME(nsIdx, "Int64Array"), UA_NODEID_NULL, attr, NULL, NULL);
}

/* ---- Common address space ------------------------------------------------------------------
 * Everything below mirrors ref/uaNet/RefServer/RefNodeManager.cs and
 * ref/opcjs/RefServer/addressSpace.ts; expected values are verified by
 * ref/opcjs/RefClientNode/tests/commonAddressSpace.ts. */

#define MANY_CHILDREN_COUNT 150
#define LARGE_ARRAY_LENGTH 20000
#define ACCESS_READ_WRITE (UA_ACCESSLEVELMASK_READ | UA_ACCESSLEVELMASK_WRITE)

static UA_StatusCode addVar(UA_Server *server, UA_NodeId id, UA_NodeId parent, UA_NodeId referenceType,
                            const char *name, const UA_Variant *value, UA_NodeId dataType,
                            UA_Int32 valueRank, UA_Byte accessLevel, UA_Boolean historizing,
                            UA_NodeId typeDefinition) {
    UA_VariableAttributes attr = UA_VariableAttributes_default;
    attr.displayName = UA_LOCALIZEDTEXT("", (char *) (uintptr_t) name);
    attr.dataType = dataType;
    attr.valueRank = valueRank;
    attr.accessLevel = accessLevel;
    attr.historizing = historizing;
    UA_UInt32 arrayDimensions[1] = {0};
    if(valueRank == UA_VALUERANK_ONE_DIMENSION) {
        attr.arrayDimensionsSize = 1;
        attr.arrayDimensions = arrayDimensions;
    }
    attr.value = *value;
    return UA_Server_addVariableNode(server, id, parent, referenceType,
                                     UA_QUALIFIEDNAME(g_ns, (char *) (uintptr_t) name),
                                     typeDefinition, attr, NULL, NULL);
}

/* A plain, read/write variable organized by `parent`. */
static UA_StatusCode addPlainVar(UA_Server *server, UA_NodeId parent, const char *name,
                                 const UA_Variant *value, UA_NodeId dataType, UA_Int32 valueRank,
                                 UA_Byte accessLevel) {
    return addVar(server, UA_NODEID_STRING(g_ns, (char *) (uintptr_t) name), parent, UA_NS0ID(ORGANIZES),
                  name, value, dataType, valueRank, accessLevel, false, UA_NODEID_NULL);
}

static UA_StatusCode addPlainScalarInt32(UA_Server *server, UA_NodeId parent, const char *name,
                                         UA_Int32 value, UA_Byte accessLevel) {
    UA_Variant variant;
    UA_Variant_setScalar(&variant, &value, &UA_TYPES[UA_TYPES_INT32]);
    return addPlainVar(server, parent, name, &variant, UA_TYPES[UA_TYPES_INT32].typeId,
                       UA_VALUERANK_SCALAR, accessLevel);
}

static UA_StatusCode addProperty(UA_Server *server, const char *ownerName, const char *name,
                                 const UA_Variant *value, UA_NodeId dataType, UA_Int32 valueRank) {
    char id[128];
    snprintf(id, sizeof(id), "%s.%s", ownerName, name);
    return addVar(server, UA_NODEID_STRING(g_ns, id), UA_NODEID_STRING(g_ns, (char *) (uintptr_t) ownerName),
                  UA_NS0ID(HASPROPERTY), name, value, dataType, valueRank, UA_ACCESSLEVELMASK_READ, false,
                  UA_NS0ID(PROPERTYTYPE));
}

static UA_NodeId addFolder(UA_Server *server, const char *name) {
    UA_ObjectAttributes attr = UA_ObjectAttributes_default;
    attr.displayName = UA_LOCALIZEDTEXT("", (char *) (uintptr_t) name);
    UA_NodeId id = UA_NODEID_STRING(g_ns, (char *) (uintptr_t) name);
    UA_Server_addObjectNode(server, id, UA_NS0ID(OBJECTSFOLDER), UA_NS0ID(ORGANIZES),
                            UA_QUALIFIEDNAME(g_ns, (char *) (uintptr_t) name), UA_NS0ID(FOLDERTYPE),
                            attr, NULL, NULL);
    return id;
}

/* Adds Scalar_<name> (holding values[0]) and Array_<name> (holding both values). */
static void addScalarAndArray(UA_Server *server, const char *name, const UA_DataType *type, void *values,
                              UA_NodeId scalars, UA_NodeId arrays) {
    char id[64];
    UA_Variant variant;

    snprintf(id, sizeof(id), "Scalar_%s", name);
    UA_Variant_setScalar(&variant, values, type);
    addPlainVar(server, scalars, id, &variant, type->typeId, UA_VALUERANK_SCALAR, ACCESS_READ_WRITE);

    snprintf(id, sizeof(id), "Array_%s", name);
    UA_Variant_setArray(&variant, values, 2, type);
    addPlainVar(server, arrays, id, &variant, type->typeId, UA_VALUERANK_ONE_DIMENSION, ACCESS_READ_WRITE);
}

static void addScalarsAndArrays(UA_Server *server) {
    UA_NodeId scalars = addFolder(server, "Scalars");
    UA_NodeId arrays = addFolder(server, "Arrays");

    UA_Boolean vBoolean[2] = {true, false};
    UA_SByte vSByte[2] = {-5, 5};
    UA_Byte vByte[2] = {5, 250};
    UA_Int16 vInt16[2] = {-300, 300};
    UA_UInt16 vUInt16[2] = {300, 60000};
    UA_Int32 vInt32[2] = {-70000, 70000};
    UA_UInt32 vUInt32[2] = {70000u, 4000000000u};
    UA_Int64 vInt64[2] = {-5000000000LL, 5000000000LL};
    UA_UInt64 vUInt64[2] = {5000000000ULL, 10000000000ULL};
    UA_Float vFloat[2] = {1.5f, -2.5f};
    UA_Double vDouble[2] = {2.25, -4.5};
    UA_String vString[2] = {UA_STRING_STATIC("hello"), UA_STRING_STATIC("world")};
    UA_DateTime vDateTime[2] = {
        UA_DateTime_fromStruct((UA_DateTimeStruct) {0, 0, 0, 0, 0, 0, 1, 1, 2020}),
        UA_DateTime_fromStruct((UA_DateTimeStruct) {0, 0, 0, 45, 30, 12, 15, 6, 2021}),
    };
    UA_Guid vGuid[2] = {
        {0x72962b91, 0xfa75, 0x4ae6, {0x8d, 0x28, 0xb4, 0x04, 0xdc, 0x7d, 0xaf, 0x63}},
        {0x1b4e28ba, 0x2fa1, 0x11d2, {0x88, 0x3f, 0xb9, 0xa7, 0x61, 0xbd, 0xe3, 0xfb}},
    };
    UA_Byte bytes1[4] = {1, 2, 3, 4};
    UA_Byte bytes2[2] = {5, 6};
    UA_ByteString vByteString[2] = {{4, bytes1}, {2, bytes2}};
    UA_XmlElement vXml[2] = {UA_STRING_STATIC("<a>b</a>"), UA_STRING_STATIC("<c>d</c>")};
    UA_NodeId vNodeId[2] = {UA_NODEID_STRING(g_ns, "Integer"), UA_NODEID_NUMERIC(0, 85)};
    UA_ExpandedNodeId vExpandedNodeId[2] = {UA_EXPANDEDNODEID_STRING(g_ns, "Integer"),
                                            UA_EXPANDEDNODEID_NUMERIC(0, 85)};
    UA_StatusCode vStatusCode[2] = {UA_STATUSCODE_BADUNEXPECTEDERROR, UA_STATUSCODE_GOOD};
    UA_QualifiedName vQualifiedName[2] = {UA_QUALIFIEDNAME(g_ns, "qname"), UA_QUALIFIEDNAME(0, "other")};
    UA_LocalizedText vLocalizedText[2] = {UA_LOCALIZEDTEXT("en", "text"), UA_LOCALIZEDTEXT("de", "Text")};

    addScalarAndArray(server, "Boolean", &UA_TYPES[UA_TYPES_BOOLEAN], vBoolean, scalars, arrays);
    addScalarAndArray(server, "SByte", &UA_TYPES[UA_TYPES_SBYTE], vSByte, scalars, arrays);
    addScalarAndArray(server, "Byte", &UA_TYPES[UA_TYPES_BYTE], vByte, scalars, arrays);
    addScalarAndArray(server, "Int16", &UA_TYPES[UA_TYPES_INT16], vInt16, scalars, arrays);
    addScalarAndArray(server, "UInt16", &UA_TYPES[UA_TYPES_UINT16], vUInt16, scalars, arrays);
    addScalarAndArray(server, "Int32", &UA_TYPES[UA_TYPES_INT32], vInt32, scalars, arrays);
    addScalarAndArray(server, "UInt32", &UA_TYPES[UA_TYPES_UINT32], vUInt32, scalars, arrays);
    addScalarAndArray(server, "Int64", &UA_TYPES[UA_TYPES_INT64], vInt64, scalars, arrays);
    addScalarAndArray(server, "UInt64", &UA_TYPES[UA_TYPES_UINT64], vUInt64, scalars, arrays);
    addScalarAndArray(server, "Float", &UA_TYPES[UA_TYPES_FLOAT], vFloat, scalars, arrays);
    addScalarAndArray(server, "Double", &UA_TYPES[UA_TYPES_DOUBLE], vDouble, scalars, arrays);
    addScalarAndArray(server, "String", &UA_TYPES[UA_TYPES_STRING], vString, scalars, arrays);
    addScalarAndArray(server, "DateTime", &UA_TYPES[UA_TYPES_DATETIME], vDateTime, scalars, arrays);
    addScalarAndArray(server, "Guid", &UA_TYPES[UA_TYPES_GUID], vGuid, scalars, arrays);
    addScalarAndArray(server, "ByteString", &UA_TYPES[UA_TYPES_BYTESTRING], vByteString, scalars, arrays);
    addScalarAndArray(server, "XmlElement", &UA_TYPES[UA_TYPES_XMLELEMENT], vXml, scalars, arrays);
    addScalarAndArray(server, "NodeId", &UA_TYPES[UA_TYPES_NODEID], vNodeId, scalars, arrays);
    addScalarAndArray(server, "ExpandedNodeId", &UA_TYPES[UA_TYPES_EXPANDEDNODEID], vExpandedNodeId, scalars, arrays);
    addScalarAndArray(server, "StatusCode", &UA_TYPES[UA_TYPES_STATUSCODE], vStatusCode, scalars, arrays);
    addScalarAndArray(server, "QualifiedName", &UA_TYPES[UA_TYPES_QUALIFIEDNAME], vQualifiedName, scalars, arrays);
    addScalarAndArray(server, "LocalizedText", &UA_TYPES[UA_TYPES_LOCALIZEDTEXT], vLocalizedText, scalars, arrays);

    UA_Variant variant;

    UA_String variantString = UA_STRING_STATIC("variant");
    UA_Variant_setScalar(&variant, &variantString, &UA_TYPES[UA_TYPES_STRING]);
    addPlainVar(server, scalars, "Scalar_Variant", &variant, UA_NS0ID(BASEDATATYPE), UA_VALUERANK_SCALAR,
                ACCESS_READ_WRITE);

    UA_Range range = {1.5, 9.5};
    UA_Variant_setScalar(&variant, &range, &UA_TYPES[UA_TYPES_RANGE]);
    addPlainVar(server, scalars, "Scalar_ExtensionObject", &variant, UA_NS0ID(STRUCTURE), UA_VALUERANK_SCALAR,
                ACCESS_READ_WRITE);

    UA_Int32 seven = 7;
    UA_DataValue dataValue;
    UA_DataValue_init(&dataValue);
    UA_Variant_setScalar(&dataValue.value, &seven, &UA_TYPES[UA_TYPES_INT32]);
    dataValue.hasValue = true;
    UA_Variant_setScalar(&variant, &dataValue, &UA_TYPES[UA_TYPES_DATAVALUE]);
    addPlainVar(server, scalars, "Scalar_DataValue", &variant, UA_NS0ID(DATAVALUE), UA_VALUERANK_SCALAR,
                ACCESS_READ_WRITE);

    UA_DiagnosticInfo diagnosticInfo;
    UA_DiagnosticInfo_init(&diagnosticInfo);
    diagnosticInfo.hasSymbolicId = true;
    diagnosticInfo.symbolicId = 1;
    diagnosticInfo.hasAdditionalInfo = true;
    diagnosticInfo.additionalInfo = UA_STRING("info");
    UA_Variant_setScalar(&variant, &diagnosticInfo, &UA_TYPES[UA_TYPES_DIAGNOSTICINFO]);
    addPlainVar(server, scalars, "Scalar_DiagnosticInfo", &variant, UA_NS0ID(DIAGNOSTICINFO),
                UA_VALUERANK_SCALAR, ACCESS_READ_WRITE);

    /* Larger than a single chunk, so reads/writes exercise multi-chunk messages. */
    UA_Double *large = (UA_Double *) UA_Array_new(LARGE_ARRAY_LENGTH, &UA_TYPES[UA_TYPES_DOUBLE]);
    if(large) {
        for(size_t i = 0; i < LARGE_ARRAY_LENGTH; i++)
            large[i] = (UA_Double) i;
        UA_Variant_setArray(&variant, large, LARGE_ARRAY_LENGTH, &UA_TYPES[UA_TYPES_DOUBLE]);
        addPlainVar(server, arrays, "LargeDoubleArray", &variant, UA_TYPES[UA_TYPES_DOUBLE].typeId,
                    UA_VALUERANK_ONE_DIMENSION, ACCESS_READ_WRITE);
        UA_Array_delete(large, LARGE_ARRAY_LENGTH, &UA_TYPES[UA_TYPES_DOUBLE]);
    }
}

static void addNodeIds(UA_Server *server) {
    UA_NodeId folder = addFolder(server, "NodeIds");
    UA_Guid guid = {0x1b4e28ba, 0x2fa1, 0x11d2, {0x88, 0x3f, 0xb9, 0xa7, 0x61, 0xbd, 0xe3, 0xfb}};
    UA_Byte opaque[4] = {1, 2, 3, 4};

    UA_NodeId opaqueId;
    UA_NodeId_init(&opaqueId);
    opaqueId.namespaceIndex = g_ns;
    opaqueId.identifierType = UA_NODEIDTYPE_BYTESTRING;
    opaqueId.identifier.byteString.length = sizeof(opaque);
    opaqueId.identifier.byteString.data = opaque;

    UA_NodeId ids[4] = {UA_NODEID_NUMERIC(g_ns, 1000), UA_NODEID_STRING(g_ns, "Id_String"),
                        UA_NODEID_GUID(g_ns, guid), opaqueId};
    const char *names[4] = {"Id_Numeric", "Id_String", "Id_Guid", "Id_Opaque"};

    for(int i = 0; i < 4; i++) {
        UA_Int32 value = i + 1;
        UA_Variant variant;
        UA_Variant_setScalar(&variant, &value, &UA_TYPES[UA_TYPES_INT32]);
        addVar(server, ids[i], folder, UA_NS0ID(ORGANIZES), names[i], &variant, UA_TYPES[UA_TYPES_INT32].typeId,
               UA_VALUERANK_SCALAR, ACCESS_READ_WRITE, false, UA_NODEID_NULL);
    }
}

static void addAccessLevelVariants(UA_Server *server) {
    UA_NodeId objects = UA_NS0ID(OBJECTSFOLDER);
    addPlainScalarInt32(server, objects, "ReadOnly_Int32", 42, UA_ACCESSLEVELMASK_READ);
    addPlainScalarInt32(server, objects, "WriteOnly_Int32", 42, UA_ACCESSLEVELMASK_WRITE);
    addPlainScalarInt32(server, objects, "Timestamped_Int32", 42,
                        ACCESS_READ_WRITE | UA_ACCESSLEVELMASK_STATUSWRITE | UA_ACCESSLEVELMASK_TIMESTAMPWRITE);

    UA_Int32 value = 42;
    UA_Variant variant;
    UA_Variant_setScalar(&variant, &value, &UA_TYPES[UA_TYPES_INT32]);
    addVar(server, UA_NODEID_STRING(g_ns, "Historizing_Int32"), objects, UA_NS0ID(ORGANIZES), "Historizing_Int32",
           &variant, UA_TYPES[UA_TYPES_INT32].typeId, UA_VALUERANK_SCALAR,
           UA_ACCESSLEVELMASK_READ | UA_ACCESSLEVELMASK_HISTORYREAD, true, UA_NODEID_NULL);

    addPlainScalarInt32(server, objects, "Static_Int32", 7, ACCESS_READ_WRITE);
}

static void addManyChildren(UA_Server *server) {
    UA_NodeId folder = addFolder(server, "ManyChildren");
    for(int i = 0; i < MANY_CHILDREN_COUNT; i++) {
        char name[32];
        snprintf(name, sizeof(name), "Child_%03d", i);
        addPlainScalarInt32(server, folder, name, i, ACCESS_READ_WRITE);
    }
}

/* Add(a, b) -> a + b */
static UA_StatusCode addMethodCallback(UA_Server *server, const UA_NodeId *sessionId, void *sessionContext,
                                       const UA_NodeId *methodId, void *methodContext,
                                       const UA_NodeId *objectId, void *objectContext,
                                       size_t inputSize, const UA_Variant *input,
                                       size_t outputSize, UA_Variant *output) {
    (void) server; (void) sessionId; (void) sessionContext; (void) methodId; (void) methodContext;
    (void) objectId; (void) objectContext; (void) inputSize; (void) outputSize;
    UA_Int32 sum = (UA_Int32) ((UA_UInt32) *(UA_Int32 *) input[0].data + (UA_UInt32) *(UA_Int32 *) input[1].data);
    return UA_Variant_setScalarCopy(&output[0], &sum, &UA_TYPES[UA_TYPES_INT32]);
}

/* Slow(ms): completes asynchronously after `ms` milliseconds on a worker thread, so the server keeps
 * serving other requests meanwhile and the Cancel service can abort it. */
typedef struct {
    UA_Variant *output;
    UA_UInt32 ms;
    bool cancelled;
    bool done;
} SlowJob;

#define MAX_SLOW_JOBS 32
static pthread_mutex_t g_slowLock = PTHREAD_MUTEX_INITIALIZER;
static SlowJob *g_slowJobs[MAX_SLOW_JOBS];

static void *slowWorker(void *arg) {
    SlowJob *job = (SlowJob *) arg;
    for(UA_UInt32 waited = 0; waited < job->ms; waited += 10) {
        usleep(10 * 1000);
        pthread_mutex_lock(&g_slowLock);
        bool cancelled = job->cancelled;
        pthread_mutex_unlock(&g_slowLock);
        if(cancelled)
            break;
    }

    pthread_mutex_lock(&g_slowLock);
    if(!job->cancelled)
        UA_Server_setAsyncCallMethodResult(g_server, job->output, UA_STATUSCODE_GOOD);
    for(size_t i = 0; i < MAX_SLOW_JOBS; i++)
        if(g_slowJobs[i] == job)
            g_slowJobs[i] = NULL;
    pthread_mutex_unlock(&g_slowLock);
    free(job);
    return NULL;
}

static UA_StatusCode slowMethodCallback(UA_Server *server, const UA_NodeId *sessionId, void *sessionContext,
                                        const UA_NodeId *methodId, void *methodContext,
                                        const UA_NodeId *objectId, void *objectContext,
                                        size_t inputSize, const UA_Variant *input,
                                        size_t outputSize, UA_Variant *output) {
    (void) server; (void) sessionId; (void) sessionContext; (void) methodId; (void) methodContext;
    (void) objectId; (void) objectContext; (void) inputSize; (void) outputSize;

    SlowJob *job = (SlowJob *) calloc(1, sizeof(SlowJob));
    if(!job)
        return UA_STATUSCODE_BADOUTOFMEMORY;
    job->output = output;
    job->ms = *(UA_UInt32 *) input[0].data;

    pthread_mutex_lock(&g_slowLock);
    for(size_t i = 0; i < MAX_SLOW_JOBS; i++) {
        if(!g_slowJobs[i]) {
            g_slowJobs[i] = job;
            break;
        }
    }
    pthread_mutex_unlock(&g_slowLock);

    pthread_t worker;
    if(pthread_create(&worker, NULL, slowWorker, job) != 0) {
        free(job);
        return UA_STATUSCODE_BADINTERNALERROR;
    }
    pthread_detach(worker);
    return UA_STATUSCODE_GOODCOMPLETESASYNCHRONOUSLY;
}

/* The server no longer owns `out` once an async operation is cancelled: stop the worker from touching it. */
static void slowMethodCancelled(UA_Server *server, const void *out) {
    (void) server;
    pthread_mutex_lock(&g_slowLock);
    for(size_t i = 0; i < MAX_SLOW_JOBS; i++)
        if(g_slowJobs[i] && g_slowJobs[i]->output == out)
            g_slowJobs[i]->cancelled = true;
    pthread_mutex_unlock(&g_slowLock);
}

static void addMethods(UA_Server *server) {
    UA_ObjectAttributes objectAttr = UA_ObjectAttributes_default;
    objectAttr.displayName = UA_LOCALIZEDTEXT("", "Methods");
    UA_NodeId methodsId = UA_NODEID_STRING(g_ns, "Methods");
    UA_Server_addObjectNode(server, methodsId, UA_NS0ID(OBJECTSFOLDER), UA_NS0ID(ORGANIZES),
                            UA_QUALIFIEDNAME(g_ns, "Methods"), UA_NS0ID(BASEOBJECTTYPE), objectAttr, NULL, NULL);

    UA_Argument addInputs[2];
    UA_Argument_init(&addInputs[0]);
    addInputs[0].name = UA_STRING("a");
    addInputs[0].dataType = UA_TYPES[UA_TYPES_INT32].typeId;
    addInputs[0].valueRank = UA_VALUERANK_SCALAR;
    UA_Argument_init(&addInputs[1]);
    addInputs[1].name = UA_STRING("b");
    addInputs[1].dataType = UA_TYPES[UA_TYPES_INT32].typeId;
    addInputs[1].valueRank = UA_VALUERANK_SCALAR;
    UA_Argument addOutput;
    UA_Argument_init(&addOutput);
    addOutput.name = UA_STRING("sum");
    addOutput.dataType = UA_TYPES[UA_TYPES_INT32].typeId;
    addOutput.valueRank = UA_VALUERANK_SCALAR;

    UA_MethodAttributes addAttr = UA_MethodAttributes_default;
    addAttr.displayName = UA_LOCALIZEDTEXT("", "Add");
    addAttr.executable = true;
    addAttr.userExecutable = true;
    UA_Server_addMethodNode(server, UA_NODEID_STRING(g_ns, "Methods.Add"), methodsId, UA_NS0ID(HASCOMPONENT),
                            UA_QUALIFIEDNAME(g_ns, "Add"), addAttr, addMethodCallback, 2, addInputs, 1,
                            &addOutput, NULL, NULL);

    UA_Argument slowInput;
    UA_Argument_init(&slowInput);
    slowInput.name = UA_STRING("ms");
    slowInput.dataType = UA_TYPES[UA_TYPES_UINT32].typeId;
    slowInput.valueRank = UA_VALUERANK_SCALAR;

    UA_MethodAttributes slowAttr = UA_MethodAttributes_default;
    slowAttr.displayName = UA_LOCALIZEDTEXT("", "Slow");
    slowAttr.executable = true;
    slowAttr.userExecutable = true;
    UA_Server_addMethodNode(server, UA_NODEID_STRING(g_ns, "Methods.Slow"), methodsId, UA_NS0ID(HASCOMPONENT),
                            UA_QUALIFIEDNAME(g_ns, "Slow"), slowAttr, slowMethodCallback, 1, &slowInput, 0, NULL,
                            NULL, NULL);
}

static void addBaseInfo(UA_Server *server) {
    UA_NodeId objects = UA_NS0ID(OBJECTSFOLDER);
    UA_Variant variant;

    UA_Double temperatureValue = 20.0;
    UA_Variant_setScalar(&variant, &temperatureValue, &UA_TYPES[UA_TYPES_DOUBLE]);
    addPlainVar(server, objects, "Temperature", &variant, UA_TYPES[UA_TYPES_DOUBLE].typeId, UA_VALUERANK_SCALAR,
                ACCESS_READ_WRITE);

    UA_EUInformation euInformation;
    UA_EUInformation_init(&euInformation);
    euInformation.namespaceUri = UA_STRING("http://www.opcfoundation.org/UA/units/un/cefact");
    euInformation.unitId = 4408652;
    euInformation.displayName = UA_LOCALIZEDTEXT("", "\xC2\xB0" "C");
    euInformation.description = UA_LOCALIZEDTEXT("", "degree Celsius");
    UA_Variant_setScalar(&variant, &euInformation, &UA_TYPES[UA_TYPES_EUINFORMATION]);
    addProperty(server, "Temperature", "EngineeringUnits", &variant, UA_NS0ID(EUINFORMATION), UA_VALUERANK_SCALAR);

    UA_Range euRange = {0, 100};
    UA_Variant_setScalar(&variant, &euRange, &UA_TYPES[UA_TYPES_RANGE]);
    addProperty(server, "Temperature", "EURange", &variant, UA_NS0ID(RANGE), UA_VALUERANK_SCALAR);

    UA_Double priceValue = 0.0;
    UA_Variant_setScalar(&variant, &priceValue, &UA_TYPES[UA_TYPES_DOUBLE]);
    addPlainVar(server, objects, "Price", &variant, UA_TYPES[UA_TYPES_DOUBLE].typeId, UA_VALUERANK_SCALAR,
                ACCESS_READ_WRITE);

    /* CurrencyUnitType is missing from the REDUCED namespace 0 this build uses. */
    UA_DataTypeAttributes currencyTypeAttr = UA_DataTypeAttributes_default;
    currencyTypeAttr.displayName = UA_LOCALIZEDTEXT("", "CurrencyUnitType");
    UA_Server_addDataTypeNode(server, UA_NODEID_NUMERIC(0, UA_NS0ID_CURRENCYUNITTYPE), UA_NS0ID(STRUCTURE),
                              UA_NS0ID(HASSUBTYPE), UA_QUALIFIEDNAME(0, "CurrencyUnitType"), currencyTypeAttr,
                              NULL, NULL);
    UA_CurrencyUnitType currency;
    UA_CurrencyUnitType_init(&currency);
    currency.numericCode = 978;
    currency.exponent = 2;
    currency.alphabeticCode = UA_STRING("EUR");
    currency.currency = UA_LOCALIZEDTEXT("", "Euro");
    UA_Variant_setScalar(&variant, &currency, &UA_TYPES[UA_TYPES_CURRENCYUNITTYPE]);
    addProperty(server, "Price", "CurrencyUnit", &variant, UA_NS0ID(CURRENCYUNITTYPE), UA_VALUERANK_SCALAR);

    UA_String modeValue = UA_STRING_STATIC("Auto");
    UA_Variant_setScalar(&variant, &modeValue, &UA_TYPES[UA_TYPES_STRING]);
    addPlainVar(server, objects, "Mode", &variant, UA_TYPES[UA_TYPES_STRING].typeId, UA_VALUERANK_SCALAR,
                ACCESS_READ_WRITE);

    UA_String selections[3] = {UA_STRING_STATIC("Auto"), UA_STRING_STATIC("Manual"), UA_STRING_STATIC("Off")};
    UA_Variant_setArray(&variant, selections, 3, &UA_TYPES[UA_TYPES_STRING]);
    addProperty(server, "Mode", "Selections", &variant, UA_TYPES[UA_TYPES_STRING].typeId,
                UA_VALUERANK_ONE_DIMENSION);

    UA_LocalizedText descriptions[3] = {UA_LOCALIZEDTEXT("", "Automatic control"),
                                        UA_LOCALIZEDTEXT("", "Manual control"),
                                        UA_LOCALIZEDTEXT("", "Disabled")};
    UA_Variant_setArray(&variant, descriptions, 3, &UA_TYPES[UA_TYPES_LOCALIZEDTEXT]);
    addProperty(server, "Mode", "SelectionDescriptions", &variant, UA_TYPES[UA_TYPES_LOCALIZEDTEXT].typeId,
                UA_VALUERANK_ONE_DIMENSION);

    UA_Boolean restrictToList = true;
    UA_Variant_setScalar(&variant, &restrictToList, &UA_TYPES[UA_TYPES_BOOLEAN]);
    addProperty(server, "Mode", "RestrictToList", &variant, UA_TYPES[UA_TYPES_BOOLEAN].typeId,
                UA_VALUERANK_SCALAR);
}

/* Adds everything except "Integer"/"Int64Array" (added by addIntegerVariable/addInt64ArrayVariable)
 * and the timer-driven "Triangle". */
static void addCommonAddressSpace(UA_Server *server) {
    addScalarsAndArrays(server);
    addNodeIds(server);
    addAccessLevelVariants(server);
    addManyChildren(server);
    addMethods(server);
    addBaseInfo(server);
}

/* Triangle wave (0..100, step 1) advanced by a repeated callback, for filter/deadband tests. */
static void advanceTriangle(UA_Server *server, void *data) {
    static int value = 0;
    static int step = 1;
    value += step;
    if(value >= 100 || value <= 0)
        step = -step;

    UA_Double next = (UA_Double) value;
    UA_Variant variant;
    UA_Variant_setScalar(&variant, &next, &UA_TYPES[UA_TYPES_DOUBLE]);
    UA_Server_writeValue(server, *(UA_NodeId *) data, variant);
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

    char *username = getenv("OPCUA_REF_USERNAME");
    char *password = getenv("OPCUA_REF_PASSWORD");
    UA_Boolean haveUsername = username && username[0] != '\0';
    UA_Boolean havePassword = password && password[0] != '\0';
    if(haveUsername != havePassword) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Set both OPCUA_REF_USERNAME and OPCUA_REF_PASSWORD, or neither.");
        return EXIT_FAILURE;
    }

    UA_ByteString certificate = UA_BYTESTRING_NULL;
    UA_ByteString privateKey = UA_BYTESTRING_NULL;
    UA_StatusCode res = ensureOwnCertificate(&certificate, &privateKey);
    if(res != UA_STATUSCODE_GOOD) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Could not create the self-signed certificate: %s", UA_StatusCode_name(res));
        return EXIT_FAILURE;
    }

    UA_Server *server = UA_Server_new();
    g_server = server;
    UA_ServerConfig *config = UA_Server_getConfig(server);
    config->globalNotificationCallback = trackNotification;
    config->asyncOperationCancelCallback = slowMethodCancelled;

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

    if(haveUsername) {
        UA_UsernamePasswordLogin login = {
            UA_STRING(username),
            UA_STRING(password)
        };
        const UA_String tokenPolicyUri = UA_SECURITY_POLICY_NONE_URI;
        config->allowNonePolicyPassword = true;
        config->accessControl.clear(&config->accessControl);
        res = UA_AccessControl_default(config, true, &tokenPolicyUri, 1, &login);
        if(res != UA_STATUSCODE_GOOD) {
            UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                         "Could not configure username authentication: %s", UA_StatusCode_name(res));
            UA_Server_delete(server);
            return EXIT_FAILURE;
        }
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

    res = addInt64ArrayVariable(server);
    if(res != UA_STATUSCODE_GOOD) {
        UA_LOG_FATAL(UA_Log_Stdout, UA_LOGCATEGORY_SERVER,
                     "Could not add the Int64Array variable: %s", UA_StatusCode_name(res));
        UA_Server_delete(server);
        return EXIT_FAILURE;
    }

    addCommonAddressSpace(server);

    UA_NodeId triangleNodeId = UA_NODEID_STRING(g_ns, "Triangle");
    UA_Double triangleInitial = 0.0;
    UA_Variant triangleVariant;
    UA_Variant_setScalar(&triangleVariant, &triangleInitial, &UA_TYPES[UA_TYPES_DOUBLE]);
    addPlainVar(server, UA_NS0ID(OBJECTSFOLDER), "Triangle", &triangleVariant, UA_TYPES[UA_TYPES_DOUBLE].typeId,
                UA_VALUERANK_SCALAR, ACCESS_READ_WRITE);

    UA_UInt64 incrementCallbackId = 0;
    UA_Server_addRepeatedCallback(server, incrementInteger, &integerNodeId, 200, &incrementCallbackId);
    UA_UInt64 triangleCallbackId = 0;
    UA_Server_addRepeatedCallback(server, advanceTriangle, &triangleNodeId, 200, &triangleCallbackId);

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
