const { OPCODES } = require('./InstructionSet');

class Executor {
  constructor(config = {}) {
    this.config = {
      maxInstructions: config.maxInstructions ?? 256,
      traceEnabled: config.traceEnabled ?? true,
    };
  }

  run(program, input) {
    if (!Array.isArray(program)) throw new Error('program must be an array');
    if (program.length > this.config.maxInstructions) throw new Error('program too long');
    const state = { acc: 0, mem: 0, count: 0, halted: false, pc: 0 };
    const trace = [];
    for (let pc = 0; pc < program.length; pc++) {
      if (state.halted) break;
      const inst = program[pc];
      if (!inst || !OPCODES.includes(inst.op)) throw new Error(`invalid instruction at ${pc}`);
      state.pc = pc;
      const before = { ...state };
      this.#step(state, inst, input);
      const after = { ...state };
      if (this.config.traceEnabled) trace.push({ pc, inst, before, after });
    }
    return { output: state.acc & 1, state, trace };
  }

  #bit(input, idx) {
    if (!Array.isArray(input)) return 0;
    if (typeof idx !== 'number' || Number.isNaN(idx)) return 0;
    return input[idx] ? 1 : 0;
  }

  #step(state, inst, input) {
    const arg = inst.arg;
    switch (inst.op) {
      case 'SET_BIT': state.acc = this.#bit(input, arg); break;
      case 'XOR_BIT': state.acc = (state.acc ^ this.#bit(input, arg)) & 1; break;
      case 'AND_BIT': state.acc = (state.acc & this.#bit(input, arg)) & 1; break;
      case 'OR_BIT': state.acc = (state.acc | this.#bit(input, arg)) & 1; break;
      case 'NOT': state.acc = state.acc ? 0 : 1; break;
      case 'ADD_BIT': state.count += this.#bit(input, arg); break;
      case 'RESET_COUNT': state.count = 0; break;
      case 'COUNT_GE': state.acc = state.count >= (arg ?? 0) ? 1 : 0; break;
      case 'COUNT_EQ': state.acc = state.count === (arg ?? 0) ? 1 : 0; break;
      case 'STORE_MEM': state.mem = state.acc & 1; break;
      case 'LOAD_MEM': state.acc = state.mem & 1; break;
      case 'AND_MEM': state.acc = (state.acc & state.mem) & 1; break;
      case 'OR_MEM': state.acc = (state.acc | state.mem) & 1; break;
      case 'XOR_MEM': state.acc = (state.acc ^ state.mem) & 1; break;
      case 'SET_CONST': state.acc = (arg ?? 0) ? 1 : 0; break;
      case 'RETURN': state.halted = true; break;
      case 'NOOP': break;
      default: throw new Error(`Unsupported opcode: ${inst.op}`);
    }
  }
}

module.exports = Executor;
