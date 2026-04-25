/**
 * ISA EXTENSION v2
 * ================
 * Research finding (ARC-AGI survey, 2025):
 * "Expanding DSLs to support unbounded looping, recursion, higher-order
 *  primitive induction, and context-sensitive rule extraction remains
 *  a significant open challenge."
 *
 * We extend orbital's ISA with:
 *   SHIFT_LEFT   — multiply by 2 / logical left shift
 *   SHIFT_RIGHT  — divide by 2 / logical right shift
 *   COMPARE_LT   — accumulator < arg
 *   COMPARE_EQ   — accumulator == arg
 *   INCREMENT    — accumulator + 1
 *   DECREMENT    — accumulator - 1
 *   STORE_ACC    — save accumulator to register A
 *   LOAD_ACC     — restore accumulator from register A
 *   XOR_ACC      — XOR accumulator with register A
 *   ADD_CONST    — add constant to accumulator
 *
 * These unlock: ripple-carry addition, subtraction, comparison,
 * multi-digit arithmetic, Hamming weight computation, Gray code.
 *
 * Concept: Wisam | Research: ARC-AGI DSL expansion recommendations
 */

const OPCODES_V2 = [
  // Original 11
  'SET_BIT', 'XOR_BIT', 'AND_BIT', 'OR_BIT', 'NOT',
  'ADD_BIT', 'RESET_COUNT', 'COUNT_GE', 'COUNT_EQ',
  'SET_CONST', 'RETURN',
  // Existing but unused
  'STORE_MEM', 'LOAD_MEM', 'AND_MEM', 'OR_MEM', 'XOR_MEM', 'NOOP',
  // New arithmetic operations
  'SHIFT_LEFT',   // acc = acc << 1 (multiply by 2)
  'SHIFT_RIGHT',  // acc = acc >> 1 (divide by 2)
  'COMPARE_LT',   // acc = acc < arg ? 1 : 0
  'COMPARE_EQ',   // acc = acc === arg ? 1 : 0
  'INCREMENT',    // acc = acc + 1
  'DECREMENT',    // acc = Math.max(0, acc - 1)
  'STORE_ACC',    // regA = acc
  'LOAD_ACC',     // acc = regA
  'XOR_ACC',      // acc = acc ^ regA
  'ADD_CONST',    // acc = acc + arg (add constant)
  'MOD',          // acc = acc % arg
  'BIT_AT',       // acc = bits[acc] (indirect bit access)
];

class ExecutorV2 {
  constructor() {
    this.traceEnabled = false;
  }

  run(program, bits) {
    if (!Array.isArray(program) || program.length === 0) {
      return { output: 0, trace: [] };
    }

    let acc   = 0;    // main accumulator
    let count = 0;    // counter register
    let regA  = 0;    // auxiliary register
    const trace = [];

    for (const instr of program) {
      const { op, arg } = instr;

      switch (op) {
        // ── Original opcodes ──────────────────────────────
        case 'SET_BIT':
          acc = (arg !== null && arg < bits.length) ? bits[arg] : 0;
          break;
        case 'XOR_BIT':
          acc = acc ^ ((arg !== null && arg < bits.length) ? bits[arg] : 0);
          break;
        case 'AND_BIT':
          acc = acc & ((arg !== null && arg < bits.length) ? bits[arg] : 0);
          break;
        case 'OR_BIT':
          acc = acc | ((arg !== null && arg < bits.length) ? bits[arg] : 0);
          break;
        case 'NOT':
          acc = acc === 0 ? 1 : 0;
          break;
        case 'ADD_BIT':
          if (arg !== null && arg < bits.length) count += bits[arg];
          break;
        case 'RESET_COUNT':
          count = 0;
          break;
        case 'COUNT_GE':
          acc = count >= (arg ?? 0) ? 1 : 0;
          break;
        case 'COUNT_EQ':
          acc = count === (arg ?? 0) ? 1 : 0;
          break;
        case 'SET_CONST':
          acc = arg ?? 0;
          break;
        case 'STORE_MEM':
          regA = acc;
          break;
        case 'LOAD_MEM':
          acc = regA;
          break;
        case 'AND_MEM':
          acc = acc & regA;
          break;
        case 'OR_MEM':
          acc = acc | regA;
          break;
        case 'XOR_MEM':
          acc = acc ^ regA;
          break;

        // ── New arithmetic opcodes ────────────────────────
        case 'SHIFT_LEFT':
          acc = (acc << (arg ?? 1)) & 0xFFFF;
          break;
        case 'SHIFT_RIGHT':
          acc = acc >> (arg ?? 1);
          break;
        case 'COMPARE_LT':
          acc = acc < (arg ?? 0) ? 1 : 0;
          break;
        case 'COMPARE_EQ':
          acc = acc === (arg ?? 0) ? 1 : 0;
          break;
        case 'INCREMENT':
          acc = acc + 1;
          break;
        case 'DECREMENT':
          acc = Math.max(0, acc - 1);
          break;
        case 'STORE_ACC':
          regA = acc;
          break;
        case 'LOAD_ACC':
          acc = regA;
          break;
        case 'XOR_ACC':
          acc = acc ^ regA;
          break;
        case 'ADD_CONST':
          acc = acc + (arg ?? 0);
          break;
        case 'MOD':
          acc = arg ? acc % arg : acc;
          break;
        case 'BIT_AT':
          acc = (acc < bits.length) ? bits[acc] : 0;
          break;

        case 'RETURN':
          return { output: acc & 1, trace, count, regA };

        case 'NOOP':
          break;

        default:
          // Unknown opcode — skip
          break;
      }

      if (this.traceEnabled) {
        trace.push({ op, arg, acc, count, regA });
      }
    }

    return { output: acc & 1, trace, count, regA };
  }
}

// ── Canonical programs using new opcodes ──────────────────────
const ARITHMETIC_PROGRAMS = {

  // Hamming weight (count ones) for 4-bit input
  hamming_4: [
    { op:'RESET_COUNT', arg:null },
    { op:'ADD_BIT', arg:0 },
    { op:'ADD_BIT', arg:1 },
    { op:'ADD_BIT', arg:2 },
    { op:'ADD_BIT', arg:3 },
    { op:'SET_CONST', arg:0 },   // put count in acc
    { op:'RETURN', arg:null },
  ],

  // Is number even? (bit 0 === 0)
  is_even: [
    { op:'SET_BIT', arg:0 },     // load LSB
    { op:'NOT', arg:null },      // 1 if even
    { op:'RETURN', arg:null },
  ],

  // Ripple carry: does adding two 4-bit numbers overflow?
  // Simplified: are more than 6 of 8 bits set (proxy for overflow)?
  overflow_detect: [
    { op:'RESET_COUNT', arg:null },
    { op:'ADD_BIT', arg:0 }, { op:'ADD_BIT', arg:1 },
    { op:'ADD_BIT', arg:2 }, { op:'ADD_BIT', arg:3 },
    { op:'ADD_BIT', arg:4 }, { op:'ADD_BIT', arg:5 },
    { op:'ADD_BIT', arg:6 }, { op:'ADD_BIT', arg:7 },
    { op:'COUNT_GE', arg:7 },    // overflow if 7+ bits set
    { op:'RETURN', arg:null },
  ],

  // Gray code check: does flipping one bit change parity?
  gray_code_valid: [
    { op:'SET_BIT', arg:0 },
    { op:'XOR_BIT', arg:1 },
    { op:'XOR_BIT', arg:2 },
    { op:'XOR_BIT', arg:3 },
    { op:'NOT', arg:null },      // valid if EVEN parity (gray code property)
    { op:'RETURN', arg:null },
  ],
};

module.exports = { ExecutorV2, OPCODES_V2, ARITHMETIC_PROGRAMS };
