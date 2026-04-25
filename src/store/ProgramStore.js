class ProgramStore {
  constructor() {
    this.programs = new Map();
  }

  save(record) {
    this.programs.set(record.programId, record);
    return record;
  }

  get(programId) {
    return this.programs.get(programId) || null;
  }

  list() {
    return [...this.programs.values()];
  }

  byTask(taskId) {
    return this.list().filter(x => x.taskId === taskId);
  }
}

module.exports = ProgramStore;
