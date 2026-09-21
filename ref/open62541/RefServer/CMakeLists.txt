cmake_minimum_required(VERSION 3.16)
project(RefServer C)

set(CMAKE_C_STANDARD 99)

include(FetchContent)

# Pin a specific master commit: the libwebsockets-backed WebSocket transport
# (UA_ENABLE_LWS / config->webSocketEnabled) is not yet part of any tagged
# open62541 release (checked: absent from v1.5.8), so we cannot depend on a
# released version. Bump this SHA deliberately when the feature ships in a
# release, or when picking up upstream fixes.
set(OPEN62541_GIT_TAG "e72b3c58f4905cd2d2cf2889a03f1742625c035c")

# Build only what RefServer needs: no examples/tests/docs, OpenSSL for the OPC UA
# security policies, and the libwebsockets ConnectionManager for opc.wss:// (the
# only transport opcjs-client speaks).
set(UA_ENABLE_ENCRYPTION "OPENSSL" CACHE STRING "" FORCE)
set(UA_ENABLE_LWS ON CACHE BOOL "" FORCE)
set(UA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(UA_BUILD_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(UA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(UA_ENABLE_DISCOVERY_MULTICAST OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  open62541
  GIT_REPOSITORY https://github.com/open62541/open62541.git
  GIT_TAG ${OPEN62541_GIT_TAG}
  GIT_SHALLOW FALSE
)
FetchContent_MakeAvailable(open62541)

add_executable(RefServer src/main.c)
target_link_libraries(RefServer PRIVATE open62541::open62541)
