/**
 * Builds the address space shared by all RefServers (see "Common address space" in ref/README.md).
 *
 * Everything lives in the custom namespace `http://opcjs.dev/UA/RefServer/` (ns=2) with string
 * NodeIds, except where a numeric/GUID/opaque identifier is the point of the node. Expected
 * values are verified by ref/opcjs/RefClientNode/tests/commonAddressSpace.ts.
 *
 * The `Methods` object (Add/Slow) is intentionally absent: opcjs-server has no Call service yet.
 */

import { AccessLevelFlags, AddressSpace, AttributeId, ObjectIds, ObjectTypeIds, ReferenceTypeIds } from 'opcjs-server';
import type { VariableNode } from 'opcjs-server';
import {
  CurrencyUnitType,
  DataValue,
  DiagnosticInfo,
  EUInformation,
  ExpandedNodeId,
  ExtensionObject,
  LocalizedText,
  NodeId,
  QualifiedName,
  Range,
  StatusCode,
  Variant,
  XmlElement,
  uaByte,
  uaDouble,
  uaFloat,
  uaGuid,
  uaInt16,
  uaInt32,
  uaInt64,
  uaSbyte,
  uaStatusCode,
  uaUint16,
  uaUint32,
  uaUint64,
} from 'opcjs-base';

export const CUSTOM_NAMESPACE_URI = 'http://opcjs.dev/UA/RefServer/';

const READ_WRITE = AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite;
const MANY_CHILDREN_COUNT = 150;
const LARGE_ARRAY_LENGTH = 20_000;
const GUID_VALUES = ['72962b91-fa75-4ae6-8d28-b404dc7daf63', '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb'];

export type RefAddressSpace = {
  addressSpace: AddressSpace;
  /** Auto-incremented by the server entry point. */
  integerVariable: VariableNode;
  /** Triangle wave (0..100, step 1), advanced by the server entry point. */
  triangleVariable: VariableNode;
};

type VariantInput = Parameters<typeof Variant.newFrom>[0];
type ScalarType = { name: string; dataTypeId: number; values: [Exclude<VariantInput, unknown[]>, Exclude<VariantInput, unknown[]>] };

// [first, second]: the scalar variable holds `first`, the array variable holds both.
const SCALAR_TYPES = (customNamespaceIndex: number): ScalarType[] => [
  { name: 'Boolean', dataTypeId: 1, values: [true, false] },
  { name: 'SByte', dataTypeId: 2, values: [uaSbyte(-5), uaSbyte(5)] },
  { name: 'Byte', dataTypeId: 3, values: [uaByte(5), uaByte(250)] },
  { name: 'Int16', dataTypeId: 4, values: [uaInt16(-300), uaInt16(300)] },
  { name: 'UInt16', dataTypeId: 5, values: [uaUint16(300), uaUint16(60000)] },
  { name: 'Int32', dataTypeId: 6, values: [uaInt32(-70000), uaInt32(70000)] },
  { name: 'UInt32', dataTypeId: 7, values: [uaUint32(70000), uaUint32(4000000000)] },
  { name: 'Int64', dataTypeId: 8, values: [uaInt64(-5000000000n), uaInt64(5000000000n)] },
  { name: 'UInt64', dataTypeId: 9, values: [uaUint64(5000000000n), uaUint64(10000000000n)] },
  { name: 'Float', dataTypeId: 10, values: [uaFloat(1.5), uaFloat(-2.5)] },
  { name: 'Double', dataTypeId: 11, values: [uaDouble(2.25), uaDouble(-4.5)] },
  { name: 'String', dataTypeId: 12, values: ['hello', 'world'] },
  {
    name: 'DateTime',
    dataTypeId: 13,
    values: [new Date('2020-01-01T00:00:00.000Z'), new Date('2021-06-15T12:30:45.000Z')],
  },
  { name: 'Guid', dataTypeId: 14, values: [uaGuid(GUID_VALUES[0]), uaGuid(GUID_VALUES[1])] },
  { name: 'ByteString', dataTypeId: 15, values: [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6])] },
  { name: 'XmlElement', dataTypeId: 16, values: [new XmlElement('<a>b</a>'), new XmlElement('<c>d</c>')] },
  {
    name: 'NodeId',
    dataTypeId: 17,
    values: [NodeId.newString(customNamespaceIndex, 'Integer'), NodeId.newNumeric(0, 85)],
  },
  {
    name: 'ExpandedNodeId',
    dataTypeId: 18,
    values: [
      new ExpandedNodeId(NodeId.newString(customNamespaceIndex, 'Integer')),
      new ExpandedNodeId(NodeId.newNumeric(0, 85)),
    ],
  },
  {
    name: 'StatusCode',
    dataTypeId: 19,
    values: [uaStatusCode(StatusCode.BadUnexpectedError), uaStatusCode(StatusCode.Good)],
  },
  {
    name: 'QualifiedName',
    dataTypeId: 20,
    values: [new QualifiedName(customNamespaceIndex, 'qname'), new QualifiedName(0, 'other')],
  },
  {
    name: 'LocalizedText',
    dataTypeId: 21,
    values: [new LocalizedText('en', 'text'), new LocalizedText('de', 'Text')],
  },
];

export function buildAddressSpace(): RefAddressSpace {
  const addressSpace = new AddressSpace();
  const ns = addressSpace.addNamespace(CUSTOM_NAMESPACE_URI);

  const objectsFolder = NodeId.newNumeric(0, ObjectIds.ObjectsFolder);
  const organizes = NodeId.newNumeric(0, ReferenceTypeIds.Organizes);
  const hasProperty = NodeId.newNumeric(0, ReferenceTypeIds.HasProperty);
  const hasTypeDefinition = NodeId.newNumeric(0, ReferenceTypeIds.HasTypeDefinition);
  const folderType = NodeId.newNumeric(0, ObjectTypeIds.FolderType);
  const dataType = (id: number) => NodeId.newNumeric(0, id);
  const id = (name: string) => NodeId.newString(ns, name);

  const addFolder = (name: string, parentId: NodeId): NodeId => {
    const folder = addressSpace.addObject(id(name), name);
    addressSpace.addReference(parentId, organizes, folder.nodeId);
    addressSpace.addReference(folder.nodeId, hasTypeDefinition, folderType);
    return folder.nodeId;
  };

  const addVariable = (
    nodeId: NodeId,
    name: string,
    dataTypeId: number,
    value: Variant,
    valueRank: number,
    parentId: NodeId,
    referenceTypeId: NodeId = organizes,
    accessLevel: number = READ_WRITE,
  ): VariableNode => {
    const variable = addressSpace.addVariable(
      nodeId, name, dataType(dataTypeId), value, valueRank, undefined, accessLevel,
    );
    addressSpace.addReference(parentId, referenceTypeId, variable.nodeId);
    return variable;
  };

  const addProperty = (ownerId: NodeId, ownerName: string, name: string, dataTypeId: number, value: Variant, valueRank = -1) =>
    addVariable(id(`${ownerName}.${name}`), name, dataTypeId, value, valueRank, ownerId, hasProperty, AccessLevelFlags.CurrentRead);

  // ── Integer / Int64Array (Read, Write, Subscribe, Detect shutdown) ────────────────────────
  const integerVariable = addVariable(id('Integer'), 'Integer', 6, Variant.newFrom(uaInt32(0)), -1, objectsFolder);
  addVariable(id('Int64Array'), 'Int64Array', 8, Variant.newFrom([uaInt64(0n)]), 1, objectsFolder);

  // ── Scalars / Arrays: one variable per BuiltInType ────────────────────────────────────────
  const scalarsFolder = addFolder('Scalars', objectsFolder);
  const arraysFolder = addFolder('Arrays', objectsFolder);
  for (const type of SCALAR_TYPES(ns)) {
    addVariable(id(`Scalar_${type.name}`), `Scalar_${type.name}`, type.dataTypeId, Variant.newFrom(type.values[0]), -1, scalarsFolder);
    addVariable(id(`Array_${type.name}`), `Array_${type.name}`, type.dataTypeId, Variant.newFrom(type.values as VariantInput), 1, arraysFolder);
  }
  addVariable(id('Scalar_Variant'), 'Scalar_Variant', 24, Variant.newFrom('variant'), -1, scalarsFolder);
  addVariable(
    id('Scalar_ExtensionObject'), 'Scalar_ExtensionObject', 22,
    Variant.newFrom(ExtensionObject.newBinary(makeRange(1.5, 9.5))), -1, scalarsFolder,
  );
  addVariable(
    id('Scalar_DataValue'), 'Scalar_DataValue', 23,
    Variant.newFrom(new DataValue(Variant.newFrom(uaInt32(7)), StatusCode.Good)), -1, scalarsFolder,
  );
  addVariable(
    id('Scalar_DiagnosticInfo'), 'Scalar_DiagnosticInfo', 25,
    Variant.newFrom(new DiagnosticInfo({ symbolicId: 1, additionalInfo: 'info' })), -1, scalarsFolder,
  );
  addVariable(
    id('LargeDoubleArray'), 'LargeDoubleArray', 11,
    Variant.newFrom(Array.from({ length: LARGE_ARRAY_LENGTH }, (_, index) => uaDouble(index))), 1, arraysFolder,
  );

  // ── NodeId identifier types ───────────────────────────────────────────────────────────────
  const nodeIdsFolder = addFolder('NodeIds', objectsFolder);
  const identifiers: [string, NodeId, number][] = [
    ['Id_Numeric', NodeId.newNumeric(ns, 1000), 1],
    ['Id_String', id('Id_String'), 2],
    ['Id_Guid', new NodeId(ns, '1b4e28ba-2fa1-11d2-883f-b9a761bde3fb'), 3],
    ['Id_Opaque', new NodeId(ns, new Uint8Array([1, 2, 3, 4])), 4],
  ];
  for (const [name, nodeId, value] of identifiers) {
    addVariable(nodeId, name, 6, Variant.newFrom(uaInt32(value)), -1, nodeIdsFolder);
  }

  // ── Access level variants ─────────────────────────────────────────────────────────────────
  addVariable(id('ReadOnly_Int32'), 'ReadOnly_Int32', 6, Variant.newFrom(uaInt32(42)), -1, objectsFolder, organizes, AccessLevelFlags.CurrentRead);
  addVariable(id('WriteOnly_Int32'), 'WriteOnly_Int32', 6, Variant.newFrom(uaInt32(42)), -1, objectsFolder, organizes, AccessLevelFlags.CurrentWrite);
  addVariable(
    id('Timestamped_Int32'), 'Timestamped_Int32', 6, Variant.newFrom(uaInt32(42)), -1, objectsFolder, organizes,
    READ_WRITE | AccessLevelFlags.StatusWrite | AccessLevelFlags.TimestampWrite,
  );
  const historizing = addVariable(
    id('Historizing_Int32'), 'Historizing_Int32', 6, Variant.newFrom(uaInt32(42)), -1, objectsFolder, organizes,
    AccessLevelFlags.CurrentRead | AccessLevelFlags.HistoryRead,
  );
  historizing.write(AttributeId.Historizing, new DataValue(Variant.newFrom(true), StatusCode.Good));
  addVariable(id('Static_Int32'), 'Static_Int32', 6, Variant.newFrom(uaInt32(7)), -1, objectsFolder);

  // ── Triangle wave: known timer-driven pattern for filter/deadband tests ───────────────────
  const triangleVariable = addVariable(id('Triangle'), 'Triangle', 11, Variant.newFrom(uaDouble(0)), -1, objectsFolder);

  // ── ManyChildren: continuation point / BrowseNext tests ───────────────────────────────────
  const manyChildren = addFolder('ManyChildren', objectsFolder);
  for (let index = 0; index < MANY_CHILDREN_COUNT; index++) {
    const name = `Child_${String(index).padStart(3, '0')}`;
    addVariable(id(name), name, 6, Variant.newFrom(uaInt32(index)), -1, manyChildren);
  }

  // ── Base info: EngineeringUnits / EURange, CurrencyUnit, SelectionList ───────────────────
  const temperature = addVariable(id('Temperature'), 'Temperature', 11, Variant.newFrom(uaDouble(20)), -1, objectsFolder);
  const euInformation = new EUInformation();
  euInformation.namespaceUri = 'http://www.opcfoundation.org/UA/units/un/cefact';
  euInformation.unitId = 4408652;
  euInformation.displayName = new LocalizedText(undefined, '°C');
  euInformation.description = new LocalizedText(undefined, 'degree Celsius');
  addProperty(temperature.nodeId, 'Temperature', 'EngineeringUnits', 887, Variant.newFrom(ExtensionObject.newBinary(euInformation)));
  addProperty(temperature.nodeId, 'Temperature', 'EURange', 884, Variant.newFrom(ExtensionObject.newBinary(makeRange(0, 100))));

  const price = addVariable(id('Price'), 'Price', 11, Variant.newFrom(uaDouble(0)), -1, objectsFolder);
  const currency = new CurrencyUnitType();
  currency.numericCode = 978;
  currency.exponent = 2;
  currency.alphabeticCode = 'EUR';
  currency.currency = new LocalizedText(undefined, 'Euro');
  addProperty(price.nodeId, 'Price', 'CurrencyUnit', 23498, Variant.newFrom(ExtensionObject.newBinary(currency)));

  const mode = addVariable(id('Mode'), 'Mode', 12, Variant.newFrom('Auto'), -1, objectsFolder);
  addProperty(mode.nodeId, 'Mode', 'Selections', 12, Variant.newFrom(['Auto', 'Manual', 'Off']), 1);
  addProperty(
    mode.nodeId, 'Mode', 'SelectionDescriptions', 21,
    Variant.newFrom([
      new LocalizedText(undefined, 'Automatic control'),
      new LocalizedText(undefined, 'Manual control'),
      new LocalizedText(undefined, 'Disabled'),
    ]),
    1,
  );
  addProperty(mode.nodeId, 'Mode', 'RestrictToList', 1, Variant.newFrom(true));

  return { addressSpace, integerVariable, triangleVariable };
}

function makeRange(low: number, high: number): Range {
  const range = new Range();
  range.low = low;
  range.high = high;
  return range;
}
