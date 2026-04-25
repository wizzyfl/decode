const OPCODES = Object.freeze([
  'SET_BIT',
  'XOR_BIT',
  'AND_BIT',
  'OR_BIT',
  'NOT',
  'ADD_BIT',
  'RESET_COUNT',
  'COUNT_GE',
  'COUNT_EQ',
  'STORE_MEM',
  'LOAD_MEM',
  'AND_MEM',
  'OR_MEM',
  'XOR_MEM',
  'SET_CONST',
  'RETURN',
  'NOOP',
]);

function makeInstruction(op, arg = null) {
  if (!OPCODES.includes(op)) throw new Error(`Unknown opcode: ${op}`);
  return { op, arg };
}

module.exports = { OPCODES, makeInstruction };
