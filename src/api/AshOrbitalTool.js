'use strict';

const path = require('path');
const OrbitalCore = require('./OrbitalCore');
const OrbitalMind = require('../mind/OrbitalMind');
const TrustedImprover = require('../mind/TrustedImprover');
const WebSearchEngine = require('../mind/WebSearchEngine');
const LLMBridge = require('../mind/LLMBridge');
const SystemGovernor = require('../mind/SystemGovernor');
const TaskDetector = require('../mind/TaskDetector');
const CompactReasoningCodec = require('../mind/CompactReasoningCodec');

class AshOrbitalTool {
  constructor(opts = {}) {
    this.core = opts.core || new OrbitalCore({ verbose: false, cachePath: path.join(__dirname, '../../.orbital_cache.json') });
    this.mind = opts.mind || OrbitalMind;
    this.llm = opts.llm || new LLMBridge();
    this.research = opts.research || new WebSearchEngine(this.llm);
    this.trustedImprover = opts.trustedImprover || new TrustedImprover();
    this.governor = opts.governor || new SystemGovernor({ core: this.core, mind: this.mind, research: this.research, trustedImprover: this.trustedImprover });
    this.detector = opts.detector || new TaskDetector();
    this.calls = 0;
  }

  schema() {
    return {
      name: 'ash_orbital_tool',
      trustedDefault: true,
      actions: {
        reason: { input: { input: 'string', context: 'object?' }, use: 'trusted exact/memory reasoning when possible' },
        exact: { input: { task: 'string', bits: 'number[]', k: 'number?' }, use: 'direct exact evaluation' },
        remember: { input: { fact: 'string', key: 'string?' }, use: 'store memory fact' },
        recall: { input: { query: 'string' }, use: 'search memory fuzzily' },
        research: { input: { query: 'string', options: 'object?' }, use: 'offline, external, or llm-backed research' },
        fetch_url: { input: { url: 'string', options: 'object?' }, use: 'fetch external text content directly through the research engine' },
        agi_status: { input: {}, use: 'return current trusted loop and AGI status' },
        improve_trusted: { input: { caseCount: 'number?' }, use: 'run trusted self-improvement loop only' },
        governor_plan: { input: { goal: 'string', context: 'object?' }, use: 'System 3 trusted-first plan for a goal' },
        governor_status: { input: {}, use: 'System 3 status and latest decisions' },
      },
    };
  }

  _compactOnlyEnvelope(base = {}) {
    const compact = base.compact || null;
    const envelope = {
      ok: base.ok !== false,
      tool: base.tool || 'ash_orbital_tool',
      action: base.action || null,
      trustedOnly: base.trustedOnly !== false,
      confidence: typeof base.confidence === 'number' ? base.confidence : undefined,
      grounded: base.grounded ? true : undefined,
      deferred: base.deferred ? true : undefined,
      reason: base.reason || undefined,
      compact,
    };
    return Object.fromEntries(Object.entries(envelope).filter(([, v]) => v !== undefined && v !== null));
  }

  _maybeCompactOnly(response, request = {}) {
    return request && request.compactOnly ? this._compactOnlyEnvelope(response) : response;
  }


  async call(request = {}) {
    this.calls += 1;
    const action = String(request.action || '').trim() || 'reason';
    const trustedOnly = request.trustedOnly !== false;

    if (action === 'schema') {
      return { ok: true, tool: this.schema(), calls: this.calls };
    }

    if (action === 'exact') {
      if (!request.task || !Array.isArray(request.bits)) return { ok: false, error: 'task and bits required' };
      const solved = await this.core.solve({ task: request.task, bits: request.bits, k: request.k });
      return {
        ok: true,
        tool: 'ash_orbital_tool',
        action,
        trustedOnly: true,
        result: solved,
      };
    }

    if (action === 'reason') {
      const input = request.input || request.question || request.text;
      if (!input) return { ok: false, error: 'input required' };
      const detection = this.detector.detect(input);
      const hasExplicitExternalTarget = !!(request.options && (request.options.url || (Array.isArray(request.options.urls) && request.options.urls.length > 0)));
      const shouldPreferGroundingOverDirectParse = hasExplicitExternalTarget || detection.task === 'tool_use';
      if (typeof input === 'string' && !shouldPreferGroundingOverDirectParse) {
        const parsed = this.core.parseQuestion(input);
        if (parsed && parsed.task && Array.isArray(parsed.bits)) {
          const solved = await this.core.solve(parsed);
          const exactResult = {
              answer: solved.answer,
              text: solved.answerText,
              layer: 'orbital-exact',
              method: 'ash-tool-direct-parse',
              exact: true,
              verified: solved.verifier ? solved.verifier.consistent : true,
              parsed,
              raw: solved,
            };
          return this._maybeCompactOnly({
            ok: true,
            tool: 'ash_orbital_tool',
            action,
            trustedOnly: true,
            compact: { v: 1, task: detection.task, result: CompactReasoningCodec.encodeResult(exactResult), action: CompactReasoningCodec.encodeAction({ actionType: 'tool.reason', ok: true, summary: exactResult.text, confidence: 0.99 }) },
            result: exactResult,
          }, request);
        }
      }
      const result = await this.mind.think(input, request.context || {});
      const method = String(result.method || '');
      const exactIntent = detection.task === 'strict_logic' || detection.task === 'verification';
      const trusted = ['orbital-exact', 'memory', 'nl-clarify', 'causal'].includes(result.layer) || method.includes('orbital') || method.includes('verifier') || method.includes('exact+');
      const confidence = trusted ? 0.92 : (result.verified ? 0.75 : Math.max(0.35, detection.confidence || 0.42));
      result.taskDetection = detection;
      result.critique = {
        valid: trusted || !exactIntent,
        exactIntent,
        contradictions: exactIntent && !trusted ? ['exact_intent_without_exact_resolution'] : [],
        strictness_score: exactIntent ? (trusted ? 0.95 : 0.35) : Math.min(0.85, (detection.confidence || 0.4) + 0.1),
      };
      const shouldAutoGround = !trustedOnly
        && typeof input === 'string'
        && (
          hasExplicitExternalTarget
          || (request.forceExternalOnLowConfidence && confidence < (request.confidenceThreshold || 0.6))
          || detection.task === 'tool_use'
        );
      if (shouldAutoGround) {
        const grounded = await this.research.search(input, { ...(request.options || {}), externalFirst: true });
        const externalConfidence = this._externalConfidence(grounded);
        const merged = this._mergeGroundedReasoning(input, result, grounded, confidence, externalConfidence);
        return this._maybeCompactOnly({
          ok: true,
          tool: 'ash_orbital_tool',
          action,
          trustedOnly,
          confidence: merged.confidence,
          grounded: true,
          compact: { v: 1, task: detection.task, result: CompactReasoningCodec.encodeResult(merged), action: CompactReasoningCodec.encodeAction({ actionType: 'tool.reason', ok: true, summary: merged.text, truthState: merged.truth_state || merged.truthState, resolutionStatus: merged.resolution_status || merged.resolutionStatus, confidence: merged.confidence, sourceCount: merged.source_count || merged.sourceCount, support: merged.resolution && merged.resolution.support, opposition: merged.resolution && merged.resolution.opposition }) },
          result: merged,
          initial: result,
          external: grounded,
        }, request);
      }
      if (trustedOnly && !trusted) {
        const deferredResult = {
            answer: null,
            text: 'Orbital does not consider this in a trusted lane yet. Use research or disable trustedOnly to inspect broader reasoning.',
            layer: result.layer,
            method: result.method,
          };
        return this._maybeCompactOnly({
          ok: true,
          tool: 'ash_orbital_tool',
          action,
          trustedOnly,
          deferred: true,
          reason: 'outside_trusted_lane',
          compact: { v: 1, task: detection.task, result: CompactReasoningCodec.encodeResult(deferredResult), action: CompactReasoningCodec.encodeAction({ actionType: 'tool.reason', ok: false, summary: deferredResult.text, confidence: 0.2 }) },
          result: deferredResult,
        }, request);
      }
      return this._maybeCompactOnly({ ok: true, tool: 'ash_orbital_tool', action, trustedOnly, confidence, compact: { v: 1, task: detection.task, result: CompactReasoningCodec.encodeResult(result), action: CompactReasoningCodec.encodeAction({ actionType: 'tool.reason', ok: true, summary: result.text || result.method, truthState: result.truth_state || result.truthState, resolutionStatus: result.resolution_status || result.resolutionStatus, confidence: result.confidence, sourceCount: result.source_count || result.sourceCount }) }, result }, request);
    }

    if (action == 'remember') {
      if (!request.fact) return { ok: false, error: 'fact required' };
      const stored = this.mind.tell(request.fact, request.key || null);
      return { ok: true, tool: 'ash_orbital_tool', action, trustedOnly: true, result: stored };
    }

    if (action == 'recall') {
      if (!request.query) return { ok: false, error: 'query required' };
      const hits = this.mind.recall(request.query) || [];
      return { ok: true, tool: 'ash_orbital_tool', action, trustedOnly: true, hits };
    }

    if (action == 'research') {
      if (!request.query) return { ok: false, error: 'query required' };
      const result = await this.research.search(request.query, request.options || {});
      return this._maybeCompactOnly({ ok: true, tool: 'ash_orbital_tool', action, trustedOnly: false, compact: { v: 1, task: 'research', result: CompactReasoningCodec.encodeResult({ text: result.grounded || result.answer || result.summary || '', truth_state: result.truthState || result.truth_state || null, confidence: result.confidence, source_count: Array.isArray(result.sources) ? result.sources.length : result.sourceCount || null, layer: result.mode || 'research', method: result.mode || 'research' }), action: CompactReasoningCodec.encodeAction({ actionType: 'tool.research', ok: true, summary: result.mode || 'research', truthState: result.truthState || result.truth_state, resolutionStatus: result.resolutionStatus || result.resolution_status, confidence: result.confidence, sourceCount: Array.isArray(result.sources) ? result.sources.length : result.sourceCount || null, support: result.resolution && result.resolution.support, opposition: result.resolution && result.resolution.opposition }) }, result }, request);
    }


    if (action == 'fetch_url') {
      if (!request.url) return { ok: false, error: 'url required' };
      const result = await this.research.search(request.url, { ...(request.options || {}), url: request.url, externalFirst: true });
      return this._maybeCompactOnly({ ok: true, tool: 'ash_orbital_tool', action, trustedOnly: false, compact: { v: 1, task: 'research', result: CompactReasoningCodec.encodeResult({ text: result.grounded || result.answer || result.summary || '', truth_state: result.truthState || result.truth_state || null, confidence: result.confidence, source_count: Array.isArray(result.sources) ? result.sources.length : result.sourceCount || null, layer: result.mode || 'research', method: result.mode || 'research' }), action: CompactReasoningCodec.encodeAction({ actionType: 'tool.fetch_url', ok: true, summary: result.mode || 'fetch', truthState: result.truthState || result.truth_state, resolutionStatus: result.resolutionStatus || result.resolution_status, confidence: result.confidence, sourceCount: Array.isArray(result.sources) ? result.sources.length : result.sourceCount || null }) }, result }, request);
    }

    if (action == 'improve_trusted') {
      const result = await this.trustedImprover.run({ caseCount: request.caseCount });
      return { ok: true, tool: 'ash_orbital_tool', action, trustedOnly: true, result };
    }

    if (action == 'governor_plan') {
      if (!request.goal) return { ok: false, error: 'goal required' };
      const plan = this.governor.plan(request.goal, request.context || {});
      return this._maybeCompactOnly({ ok: true, tool: 'ash_orbital_tool', action, trustedOnly: true, compact: { v: 1, goal: CompactReasoningCodec.short(request.goal, 64), plan: CompactReasoningCodec.encodePlan(plan) }, result: plan }, request);
    }

    if (action == 'governor_status') {
      const status = this.governor.status();
      return this._maybeCompactOnly({ ok: true, tool: 'ash_orbital_tool', action, trustedOnly: true, compact: { v: 1, goals: (status.compactGoals || []).slice(0, 5), trail: (status.compactTrail || []).slice(0, 5) }, result: status }, request);
    }

    if (action == 'agi_status') {
      return {
        ok: true,
        tool: 'ash_orbital_tool',
        action,
        trustedOnly: true,
        result: {
          trustedImprovement: this.trustedImprover.stats(),
          research: this.research.stats(),
          llmAvailable: this.llm.available,
        },
      };
    }

    return { ok: false, error: 'Unknown action', knownActions: Object.keys(this.schema().actions) };
  }

  _externalConfidence(grounded) {
    const stats = grounded && grounded.stats ? grounded.stats : {};
    const total = Number(stats.total || 0);
    const proven = Number(stats.proven || 0);
    const uncertain = Number(stats.uncertain || 0);
    const contradictions = Number(stats.contradictions || 0);
    const truthState = String((grounded && (grounded.truthState || grounded.truth_state)) || '').toLowerCase();
    if (!grounded || grounded.success === false) return 0.2;
    if (truthState === 'contradicted' || contradictions > 0) return 0.18;
    if (truthState === 'uncertain') return 0.38;
    if (total <= 0) return 0.45;
    const ratio = Math.max(0, Math.min(1, (proven + 0.5 * Math.max(0, total - uncertain - proven)) / total));
    return Math.max(0.35, Math.min(0.92, ratio));
  }

  _mergeGroundedReasoning(input, initial, grounded, initialConfidence, externalConfidence) {
    const findings = Array.isArray(grounded && grounded.findings) ? grounded.findings : [];
    const normalizedTruthState = String((grounded && (grounded.truthState || grounded.truth_state)) || '').toLowerCase();
    const contradicted = normalizedTruthState === 'contradicted'
      || findings.some(f => String(f.status || '').toUpperCase() === 'CONTRADICTED')
      || Number((grounded && grounded.stats && grounded.stats.contradictions) || 0) > 0;
    const uncertain = !contradicted && (
      normalizedTruthState === 'uncertain'
      || findings.some(f => String(f.status || '').toUpperCase() === 'UNCERTAIN')
    );
    const truthState = contradicted ? 'contradicted' : (uncertain ? 'uncertain' : 'verified');
    const resolutionStatus = String((grounded && (grounded.resolutionStatus || (grounded.resolution && grounded.resolution.status))) || '').toLowerCase() || null;
    const baseConfidence = (Number(initialConfidence || 0.4) * 0.35) + (Number(externalConfidence || 0.45) * 0.65);
    const confidence = contradicted
      ? (resolutionStatus === 'tentatively_resolved'
          ? Math.max(0.22, Math.min(0.55, baseConfidence * 0.72))
          : Math.max(0.08, Math.min(0.35, baseConfidence * 0.45)))
      : uncertain
        ? Math.max(0.2, Math.min(0.6, baseConfidence * 0.75))
        : Math.max(0.3, Math.min(0.95, baseConfidence));
    const initialText = initial && typeof initial.text === 'string' ? initial.text : String((initial && initial.answer) || '').trim();
    const externalText = grounded && (grounded.grounded || grounded.answer) ? String(grounded.grounded || grounded.answer).trim() : '';
    const textParts = [];
    if (initialText) textParts.push(`Initial reasoning: ${initialText}`);
    if (externalText) textParts.push(`Grounded evidence: ${externalText}`);
    if (truthState === 'contradicted') {
      if (resolutionStatus === 'tentatively_resolved') textParts.push('Resolution: external sources still conflict, but one side currently has materially stronger support; treat this as tentative, not settled.');
      else textParts.push('Resolution: external sources conflict; do not treat this as settled.');
    }
    if (truthState === 'uncertain') textParts.push('Resolution: evidence is incomplete or mixed; treat this cautiously.');
    const resolution = grounded && grounded.resolution ? grounded.resolution : null;
    if (resolution && resolution.note) textParts.push(`Evidence balance: ${resolution.note}`);
    return {
      answer: grounded && grounded.answer ? grounded.answer : (initial ? initial.answer : null),
      text: textParts.join('\n\n'),
      layer: 'ash+orbital-grounded',
      method: 'ash-orbital-dual-pass',
      exact: !!(initial && initial.exact),
      verified: truthState === 'verified',
      truth_state: truthState,
      source_type: grounded && grounded.mode ? 'mixed' : 'internal',
      source_count: Array.isArray(grounded && grounded.sources) ? grounded.sources.length : (grounded && grounded.mode ? 1 : 0),
      confidence,
      resolution: resolution || null,
      resolution_status: resolutionStatus,
      initial,
      grounded: grounded || null,
      query: input,
    };
  }

}

module.exports = AshOrbitalTool;
