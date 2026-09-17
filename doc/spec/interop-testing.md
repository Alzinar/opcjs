# Interop testing

The goal of interop testing is to test our client and server against other frameworks and SDKs

# 3rd Party frameworks
- UA-.NeteStandard: https://github.com/OPCFoundation/UA-.NETStandard
- Open62541: https://github.com/open62541/open62541

# Acceptance criteria
- There is a server implemented with the same OPC tree for each framework (3rd-party and ours)
- There is a test client that does the same for each framework (3rd-party and ours).
- There are tests that start each server and run our test client against it. 
- There are tests that run each client against our server.
- The tests can run each after the other.

# Tested features:
- Read integer