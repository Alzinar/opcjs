/**
 * Expected content of the address space shared by all RefServers (ns=2,
 * `http://opcjs.dev/UA/RefServer/`) — see "Common address space" in ref/README.md.
 * Each RefServer must expose exactly these nodes with exactly these initial values.
 */

import { expect } from 'vitest';
import type { Client } from 'opcjs-client';
import { DataValue, DiagnosticInfo, ExpandedNodeId, ExtensionObject, LocalizedText, NodeId, QualifiedName, StatusCode, Variant, XmlElement } from 'opcjs-base';

const NS = 2;
const id = (name: string): NodeId => NodeId.newString(NS, name);

export const MANY_CHILDREN_COUNT = 150;
export const LARGE_ARRAY_LENGTH = 20_000;

/** Browse names of the nodes directly below the Objects folder (ns=2 only). */
export const OBJECTS_FOLDER_CHILDREN = [
    'Integer', 'Int64Array', 'Scalars', 'Arrays', 'NodeIds', 'ReadOnly_Int32', 'WriteOnly_Int32',
    'Timestamped_Int32', 'Historizing_Int32', 'Static_Int32', 'Triangle', 'ManyChildren',
    'Temperature', 'Price', 'Mode',
];

/** Present on uaNet and open62541 only: opcjs-server has no Call service yet. */
export const METHODS_OBJECT = id('Methods');
export const ADD_METHOD = id('Methods.Add');
export const SLOW_METHOD = id('Methods.Slow');

type Guid = string;
const GUID_VALUES: [Guid, Guid] = ['72962b91-fa75-4ae6-8d28-b404dc7daf63', '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb'];

/** Scalar_<name> holds `first`; Array_<name> holds `[first, second]`. */
export const SCALAR_TYPES: { name: string; first: unknown; second: unknown }[] = [
    { name: 'Boolean', first: true, second: false },
    { name: 'SByte', first: -5, second: 5 },
    { name: 'Byte', first: 5, second: 250 },
    { name: 'Int16', first: -300, second: 300 },
    { name: 'UInt16', first: 300, second: 60000 },
    { name: 'Int32', first: -70000, second: 70000 },
    { name: 'UInt32', first: 70000, second: 4000000000 },
    { name: 'Int64', first: -5000000000n, second: 5000000000n },
    { name: 'UInt64', first: 5000000000n, second: 10000000000n },
    { name: 'Float', first: 1.5, second: -2.5 },
    { name: 'Double', first: 2.25, second: -4.5 },
    { name: 'String', first: 'hello', second: 'world' },
    { name: 'DateTime', first: new Date('2020-01-01T00:00:00.000Z'), second: new Date('2021-06-15T12:30:45.000Z') },
    { name: 'Guid', first: GUID_VALUES[0], second: GUID_VALUES[1] },
    { name: 'ByteString', first: [1, 2, 3, 4], second: [5, 6] },
    { name: 'XmlElement', first: '<a>b</a>', second: '<c>d</c>' },
    { name: 'NodeId', first: id('Integer').toString(), second: NodeId.newNumeric(0, 85).toString() },
    { name: 'ExpandedNodeId', first: id('Integer').toString(), second: NodeId.newNumeric(0, 85).toString() },
    { name: 'StatusCode', first: StatusCode.BadUnexpectedError, second: StatusCode.Good },
    { name: 'QualifiedName', first: `${NS}:qname`, second: '0:other' },
    { name: 'LocalizedText', first: 'en|text', second: 'de|Text' },
];

/** Reduces a decoded Variant value to a plain, comparable form (identical across servers). */
export function project(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(project);
    if (value instanceof Uint8Array) return Array.from(value);
    if (value instanceof NodeId) return value.toString();
    if (value instanceof ExpandedNodeId) return value.nodeId.toString();
    if (value instanceof QualifiedName) return `${value.namespaceIndex}:${value.name}`;
    if (value instanceof LocalizedText) return `${value.locale ?? ''}|${value.text}`;
    if (value instanceof XmlElement) return value.content;
    if (value instanceof DiagnosticInfo) return { symbolicId: value.symbolicId, additionalInfo: value.additionalInfo };
    if (value instanceof ExtensionObject) return project(value.data);
    if (value instanceof DataValue) return { value: project(value.value?.value), statusCode: value.statusCode };
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, project(entry)]));
    }
    return value;
}

type ExpectedValue = { nodeId: NodeId; expected: unknown };

export function expectedValues(): ExpectedValue[] {
    const result: ExpectedValue[] = [
        { nodeId: id('Scalar_Variant'), expected: 'variant' },
        { nodeId: id('Scalar_ExtensionObject'), expected: { low: 1.5, high: 9.5 } },
        { nodeId: id('Scalar_DataValue'), expected: { value: 7, statusCode: StatusCode.Good } },
        { nodeId: id('Scalar_DiagnosticInfo'), expected: { symbolicId: 1, additionalInfo: 'info' } },
        { nodeId: NodeId.newNumeric(NS, 1000), expected: 1 },
        { nodeId: id('Id_String'), expected: 2 },
        { nodeId: new NodeId(NS, '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb'), expected: 3 },
        { nodeId: new NodeId(NS, new Uint8Array([1, 2, 3, 4])), expected: 4 },
        { nodeId: id('ReadOnly_Int32'), expected: 42 },
        { nodeId: id('Timestamped_Int32'), expected: 42 },
        { nodeId: id('Historizing_Int32'), expected: 42 },
        { nodeId: id('Static_Int32'), expected: 7 },
        { nodeId: id('Temperature'), expected: 20 },
        {
            nodeId: id('Temperature.EngineeringUnits'),
            expected: {
                namespaceUri: 'http://www.opcfoundation.org/UA/units/un/cefact',
                unitId: 4408652,
                displayName: '|°C',
                description: '|degree Celsius',
            },
        },
        { nodeId: id('Temperature.EURange'), expected: { low: 0, high: 100 } },
        { nodeId: id('Price'), expected: 0 },
        {
            nodeId: id('Price.CurrencyUnit'),
            expected: { numericCode: 978, exponent: 2, alphabeticCode: 'EUR', currency: '|Euro' },
        },
        { nodeId: id('Mode'), expected: 'Auto' },
        { nodeId: id('Mode.Selections'), expected: ['Auto', 'Manual', 'Off'] },
        { nodeId: id('Mode.SelectionDescriptions'), expected: ['|Automatic control', '|Manual control', '|Disabled'] },
        { nodeId: id('Mode.RestrictToList'), expected: true },
        { nodeId: id('Child_000'), expected: 0 },
        { nodeId: id(`Child_${MANY_CHILDREN_COUNT - 1}`), expected: MANY_CHILDREN_COUNT - 1 },
    ];
    for (const type of SCALAR_TYPES) {
        result.push({ nodeId: id(`Scalar_${type.name}`), expected: project(type.first) });
        result.push({ nodeId: id(`Array_${type.name}`), expected: [project(type.first), project(type.second)] });
    }
    return result;
}

/** Reads the Value of `nodeId` and returns the projected value. */
async function readProjected(client: Client, nodeId: NodeId): Promise<unknown> {
    const [result] = await client.read([nodeId]);
    expect(result?.statusCode, `read of ${nodeId.toString()}`).toBe(StatusCode.Good);
    return project((result.value as Variant).value);
}

/**
 * Asserts the connected `client` sees the common address space: every expected node reads Good with
 * the expected initial value, and the Objects folder organizes the expected children.
 * `Integer`, `Triangle` (change on their own) and `Int64Array` (written by other tests) are not value-checked.
 */
export async function verifyCommonAddressSpace(client: Client, options: { hasMethods: boolean }): Promise<void> {
    const mismatches: string[] = [];
    for (const { nodeId, expected } of expectedValues()) {
        const actual = await readProjected(client, nodeId);
        if (JSON.stringify(actual, bigintReplacer) !== JSON.stringify(expected, bigintReplacer)) {
            mismatches.push(`${nodeId.toString()}: expected ${JSON.stringify(expected, bigintReplacer)}, got ${JSON.stringify(actual, bigintReplacer)}`);
        }
    }
    expect(mismatches).toEqual([]);

    const large = await readProjected(client, id('LargeDoubleArray'));
    expect(large).toHaveLength(LARGE_ARRAY_LENGTH);

    const objectChildren = (await client.browse(NodeId.newNumeric(0, 85)))
        .filter((reference) => reference.browseName.namespaceIndex === NS)
        .map((reference) => reference.browseName.name);
    for (const name of OBJECTS_FOLDER_CHILDREN) {
        expect(objectChildren, `Objects folder children`).toContain(name);
    }
    expect(objectChildren.includes('Methods')).toBe(options.hasMethods);

    const many = await client.browse(id('ManyChildren'));
    expect(many).toHaveLength(MANY_CHILDREN_COUNT);
}

function bigintReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? `${value}n` : value;
}
