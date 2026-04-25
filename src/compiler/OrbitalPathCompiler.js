const CompilerSpec = require('./CompilerSpec');
const { makeInstruction } = require('../isa/InstructionSet');

class OrbitalPathCompiler {
  constructor(spec = new CompilerSpec()) {
    this.spec = spec;
    this.version = `compiler-${spec.version}`;
  }

  compile(trace) {
    if (!trace || !Array.isArray(trace.steps)) {
      return { valid: false, errors: ['missing trace steps'], program: [] };
    }
    const errors = [];
    const program = [];
    for (const step of trace.steps) {
      const op = this.spec.nodeToOp(step.nodeId);
      let arg = null;
      if (['SET_BIT', 'XOR_BIT', 'AND_BIT', 'OR_BIT', 'ADD_BIT'].includes(op)) {
        arg = this.spec.angleToIndex(step.ejectAngle, trace.inputSize);
      } else if (['COUNT_GE', 'COUNT_EQ'].includes(op)) {
        arg = this.spec.angleToThreshold(step.ejectAngle, trace.inputSize);
      } else if (op === 'SET_CONST') {
        arg = step.ejectAngle >= 0.5 ? 1 : 0;
      }

      const repeat = Math.max(1, Math.min(step.orbitCount ?? 1, 4));
      for (let i = 0; i < repeat; i++) {
        try {
          program.push(makeInstruction(op, arg));
        } catch (err) {
          errors.push(err.message);
        }
      }
    }

    if (!program.some(inst => inst.op === 'RETURN')) {
      program.push(makeInstruction('RETURN'));
    }
    if (program.length > this.spec.maxProgramLength) {
      errors.push(`program too long: ${program.length}`);
    }
    return { valid: errors.length === 0, errors, program };
  }
}

module.exports = OrbitalPathCompiler;
