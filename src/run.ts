import type { RunState, StageState, StageName, Env } from './types';
import {
  legBackwards, legManyface, legTemperLookup, legTemperPromote,
  legDejaLookupEvents, legDejaRemember,
  legAirdeskCreateTask, legAirdeskPoll,
} from './adapters';
import { contentHash, compositeHash } from './hash';

const STAGE_NAMES: StageName[] = ['backwards', 'manyface', 'temper', 'deja-shared', 'airdesk', 'approval', 'mint', 'done'];

function makeInitialStages(): StageState[] {
  return STAGE_NAMES.map(name => ({ name, status: 'pending' as const }));
}

export class LoopupRun {
  private state: DurableObjectState;
  private sql: SqlStorage;
  private cachedRun: RunState | null = null;
  private sessions: Set<WebSocket> = new Set();

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.state = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      current_stage INTEGER NOT NULL DEFAULT 0,
      stages TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      composite_hash TEXT,
      evidence_root TEXT,
      hammer_id TEXT,
      hammer_error TEXT,
      approval_artifact_hash TEXT,
      approval_powers TEXT,
      approval_evidence_root TEXT,
      approved_artifact_hash TEXT,
      denial_reason TEXT,
      deja_instinct TEXT,
      temper_reused TEXT,
      result_summary TEXT
    )`);
  }

  private getRun(): RunState {
    if (this.cachedRun) return this.cachedRun;
    const row = this.sql.exec('SELECT * FROM runs WHERE id = ?', this.state.id.toString()).one() as Record<string, string | null> | undefined;
    if (!row) throw new Error('Run not found');
    this.cachedRun = this.rowToRun(row);
    return this.cachedRun!;
  }

  private rowToRun(row: Record<string, string | null>): RunState {
    return {
      id: row.id!,
      goal: row.goal!,
      status: row.status as RunState['status'],
      currentStage: Number(row.current_stage),
      stages: JSON.parse(row.stages!),
      createdAt: row.created_at!,
      updatedAt: row.updated_at!,
      compositeHash: row.composite_hash ?? undefined,
      evidenceRoot: row.evidence_root ?? undefined,
      hammerId: row.hammer_id ?? undefined,
      hammerError: row.hammer_error ?? undefined,
      approvalArtifactHash: row.approval_artifact_hash ?? undefined,
      approvalPowers: row.approval_powers ? JSON.parse(row.approval_powers) : undefined,
      approvalEvidenceRoot: row.approval_evidence_root ?? undefined,
      approvedArtifactHash: row.approved_artifact_hash ?? undefined,
      denialReason: row.denial_reason ?? undefined,
      dejaInstinct: row.deja_instinct ?? null,
      temperReused: row.temper_reused ? JSON.parse(row.temper_reused) : null,
      resultSummary: row.result_summary ? JSON.parse(row.result_summary) : null,
    };
  }

  private saveRun(run: RunState): void {
    run.updatedAt = new Date().toISOString();
    this.sql.exec(
      `INSERT OR REPLACE INTO runs (id, goal, status, current_stage, stages, created_at, updated_at,
        composite_hash, evidence_root, hammer_id, hammer_error,
        approval_artifact_hash, approval_powers, approval_evidence_root,
        approved_artifact_hash, denial_reason, deja_instinct, temper_reused, result_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      run.id, run.goal, run.status, run.currentStage, JSON.stringify(run.stages),
      run.createdAt, run.updatedAt,
      run.compositeHash ?? null, run.evidenceRoot ?? null,
      run.hammerId ?? null, run.hammerError ?? null,
      run.approvalArtifactHash ?? null,
      run.approvalPowers ? JSON.stringify(run.approvalPowers) : null,
      run.approvalEvidenceRoot ?? null,
      run.approvedArtifactHash ?? null, run.denialReason ?? null,
      run.dejaInstinct ?? null, run.temperReused ? JSON.stringify(run.temperReused) : null,
      run.resultSummary ? JSON.stringify(run.resultSummary) : null,
    );
    this.cachedRun = run;
  }

  private broadcastState(run: RunState): void {
    const msg = JSON.stringify({ type: 'state', run });
    for (const ws of this.sessions) {
      try { ws.send(msg); } catch { this.sessions.delete(ws); }
    }
  }

  private updateStage(run: RunState, idx: number, updates: Partial<StageState>): void {
    const merged = { ...run.stages[idx], ...updates };
    // Keep hash and data in lockstep: whenever a stage records data, its hash is
    // the hash OF that stored data. This makes replay's internal-consistency
    // check exact for every leg, deterministic or stateful.
    if ('data' in updates && merged.data != null) {
      merged.hash = contentHash(merged.data);
    }
    run.stages[idx] = merged;
    this.saveRun(run);
    this.broadcastState(run);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/init' && request.method === 'POST') {
      const body = await request.json() as { id: string; goal: string };
      const run: RunState = {
        id: body.id,
        goal: body.goal,
        status: 'created',
        currentStage: 0,
        stages: makeInitialStages(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.saveRun(run);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (path === '/ws') {
      return this.handleWebSocket();
    }

    if (path === '/state') {
      const run = this.getRun();
      return new Response(JSON.stringify(run), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (path === '/approve' && request.method === 'POST') {
      return this.handleApprove(request);
    }

    if (path === '/deny' && request.method === 'POST') {
      return this.handleDeny(request);
    }

    if (path === '/dev-sign' && request.method === 'POST') {
      return this.handleDevSign(request);
    }

    if (path === '/start' && request.method === 'POST') {
      const run = this.getRun();
      if (run.status !== 'created') {
        return new Response(JSON.stringify({ error: 'run already started' }), { status: 400 });
      }
      run.status = 'running';
      this.saveRun(run);
      this.state.storage.setAlarm(Date.now() + 100);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response('not found', { status: 404 });
  }

  private handleWebSocket(): Response {
    const pair = new (globalThis as any).WebSocketPair() as { 0: WebSocket; 1: WebSocket };
    const [client, server] = [pair[0], pair[1]];
    this.sessions.add(server);
    (server as any).accept();
    server.addEventListener('close', () => this.sessions.delete(server));
    server.addEventListener('error', () => this.sessions.delete(server));
    server.send(JSON.stringify({ type: 'state', run: this.getRun() }));
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  private async handleApprove(request: Request): Promise<Response> {
    const run = this.getRun();
    if (run.status !== 'awaiting_approval') {
      return new Response(JSON.stringify({ error: 'run not awaiting approval' }), { status: 400 });
    }
    const body = await request.json() as { artifactHash?: string };
    if (!body.artifactHash || body.artifactHash !== run.approvalArtifactHash) {
      return new Response(JSON.stringify({
        error: 'artifact hash mismatch — approval void',
        expected: run.approvalArtifactHash,
        got: body.artifactHash,
      }), { status: 409 });
    }
    run.status = 'approved';
    run.approvedArtifactHash = body.artifactHash;
    this.saveRun(run);
    this.state.storage.setAlarm(Date.now() + 100);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  private async handleDeny(request: Request): Promise<Response> {
    const run = this.getRun();
    if (run.status !== 'awaiting_approval') {
      return new Response(JSON.stringify({ error: 'run not awaiting approval' }), { status: 400 });
    }
    const body = await request.json() as { reason?: string };
    run.status = 'denied';
    run.denialReason = body.reason ?? 'denied by user';
    this.saveRun(run);
    this.broadcastState(run);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  private async handleDevSign(request: Request): Promise<Response> {
    const run = this.getRun();
    if (run.status !== 'awaiting_approval') {
      return new Response(JSON.stringify({ error: 'run not awaiting approval' }), { status: 400 });
    }
    const body = await request.json() as { artifactHash?: string };
    if (!body.artifactHash || body.artifactHash !== run.approvalArtifactHash) {
      return new Response(JSON.stringify({
        error: 'artifact hash mismatch — approval void',
        expected: run.approvalArtifactHash,
        got: body.artifactHash,
      }), { status: 409 });
    }
    run.status = 'approved';
    run.approvedArtifactHash = body.artifactHash;
    this.saveRun(run);
    this.state.storage.setAlarm(Date.now() + 100);
    return new Response(JSON.stringify({ ok: true, note: 'demo signer (not production)' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  async alarm(): Promise<void> {
    const run = this.getRun();
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'denied') return;

    try {
      await this.advanceMachine(run);
    } catch (e) {
      run.status = 'failed';
      this.saveRun(run);
      this.broadcastState(run);
    }
  }

  private async advanceMachine(run: RunState): Promise<void> {
    const stageIdx = run.currentStage;

    if (stageIdx >= STAGE_NAMES.length) {
      run.status = 'completed';
      this.saveRun(run);
      this.broadcastState(run);
      return;
    }

    const stageName = STAGE_NAMES[stageIdx];
    this.updateStage(run, stageIdx, { status: 'running' });

    switch (stageName) {
      case 'backwards': {
        const leg = await legBackwards(run.goal);
        if (leg.ok) {
          this.updateStage(run, stageIdx, { status: 'passed', hash: leg.hash, data: leg.data });
        } else {
          this.updateStage(run, stageIdx, { status: 'failed', error: leg.error });
        }
        break;
      }
      case 'manyface': {
        const claim = `compose:${run.goal}`;
        const leg = await legManyface(claim);
        if (leg.ok) {
          this.updateStage(run, stageIdx, { status: 'passed', hash: leg.hash, data: { claim, result: leg.data } });
        } else {
          this.updateStage(run, stageIdx, { status: 'failed', error: leg.error });
        }
        break;
      }
      case 'temper': {
        const shapeKey = `loopup-orchestration:${run.goal}`;
        const existing = await legTemperLookup(shapeKey);
        if (existing) {
          run.temperReused = existing;
          this.updateStage(run, stageIdx, {
            status: 'passed',
            hash: contentHash(existing),
            data: { reused: true, hammer: existing },
          });
        } else {
          const backwardsLeg = run.stages[0];
          const manyfaceLeg = run.stages[1];
          if (backwardsLeg.status === 'passed' && manyfaceLeg.status === 'passed') {
            const backwardsData = backwardsLeg.data as { hash?: string } | null;
            const manyfaceData = manyfaceLeg.data as { result?: { winnerId?: string } } | null;
            const leg = await legTemperPromote(
              backwardsData?.hash ?? '',
              shapeKey,
              manyfaceData?.result?.winnerId ?? '',
            );
            if (leg.ok) {
              this.updateStage(run, stageIdx, {
                status: 'passed',
                hash: leg.hash,
                data: { reused: false, hammer: leg.data },
              });
            } else {
              this.updateStage(run, stageIdx, { status: 'failed', error: leg.error });
            }
          } else {
            this.updateStage(run, stageIdx, { status: 'skipped', error: 'backwards or manyface did not pass' });
          }
        }
        break;
      }
      case 'deja-shared': {
        const authority = 'loopup';
        const events = await legDejaLookupEvents(run.goal, authority);
        const instinct = events.events.length > 0 ? events.events[0] : null;
        run.dejaInstinct = instinct ? JSON.stringify(instinct) : null;

        const leg = await legDejaRemember(
          `loopup-${run.id}`,
          `LoopUp run: goal=${run.goal}, instinct=${instinct ? 'injected' : 'none'}`,
          run.id,
          authority,
        );
        if (leg.ok) {
          this.updateStage(run, stageIdx, {
            status: 'passed',
            hash: leg.hash,
            data: { ...(leg.data as object), instinctFound: !!instinct, instinctInjected: !!instinct },
          });
        } else {
          this.updateStage(run, stageIdx, { status: 'failed', error: leg.error });
        }
        break;
      }
      case 'airdesk': {
        const task = await legAirdeskCreateTask(run.goal);
        if ('error' in task) {
          this.updateStage(run, stageIdx, { status: 'failed', error: task.error });
          break;
        }
        const pollResult = await legAirdeskPoll(task.workflowId);
        if (!pollResult.ok) {
          this.updateStage(run, stageIdx, { status: 'failed', error: pollResult.error });
          break;
        }
        const pollData = pollResult.data as { artifactHash?: string; evidenceRoot?: string; powers?: string[] };
        run.approvalArtifactHash = pollData.artifactHash;
        run.approvalEvidenceRoot = pollData.evidenceRoot;
        run.approvalPowers = pollData.powers;
        run.status = 'awaiting_approval';
        this.updateStage(run, stageIdx, {
          status: 'passed',
          hash: pollResult.hash,
          data: { workflowId: task.workflowId, ...pollData },
        });
        // HALT: the run blocks here until a human approves or denies. Advance the
        // stage pointer to `approval` but do NOT re-arm the alarm; approve/deny
        // resumes the machine.
        run.currentStage = stageIdx + 1;
        this.saveRun(run);
        this.broadcastState(run);
        return;
      }
      case 'approval': {
        if (run.status === 'approved') {
          this.updateStage(run, stageIdx, {
            status: 'passed',
            data: { approved: true, artifactHash: run.approvedArtifactHash },
          });
        } else {
          this.updateStage(run, stageIdx, { status: 'failed', error: 'not approved' });
          run.status = 'failed';
          this.saveRun(run);
          return;
        }
        break;
      }
      case 'mint': {
        const allLegs = run.stages.slice(0, 5);
        const allOk = allLegs.every(s => s.status === 'passed');
        if (!allOk) {
          this.updateStage(run, stageIdx, { status: 'skipped', error: 'not all stages passed' });
          run.hammerError = 'not minted: one or more stages did not pass';
          this.saveRun(run);
          break;
        }
        const legs = allLegs.map(s => ({
          service: s.name,
          ok: s.status === 'passed',
          hash: s.hash ?? '',
          data: s.data,
        }));
        const ch = compositeHash(legs as any);
        run.compositeHash = ch;
        const mintLeg = await legTemperPromote(ch, `loopup-orchestration:${run.goal}`, `composite-${ch}`);
        if (mintLeg.ok) {
          const mint = mintLeg.data as {
            hammer?: { id: string; provenance: { contentHash: string; sourceReceipt: string } };
            verification?: { passed: boolean };
          } | null;
          if (mint?.hammer) {
            run.hammerId = mint.hammer.id;
            run.hammerError = undefined;
          } else {
            run.hammerError = 'temper returned no hammer';
          }
        } else {
          run.hammerError = mintLeg.error ?? 'temper mint failed';
        }
        this.updateStage(run, stageIdx, {
          status: mintLeg.ok ? 'passed' : 'failed',
          hash: mintLeg.ok ? mintLeg.hash : undefined,
          error: mintLeg.ok ? undefined : mintLeg.error,
          data: mintLeg.ok ? mintLeg.data : undefined,
        });
        break;
      }
      case 'done': {
        const backwardsStage = run.stages[0];
        const manyfaceStage = run.stages[1];
        const temperStage = run.stages[2];

        const backwardsData = backwardsStage.data as { leafResults?: Array<{ outcome: string }>; status?: string } | null;
        const manyfaceData = manyfaceStage.data as { claim?: string; result?: { winnerId?: string; verdicts?: Array<{ passed: boolean }> } } | null;
        const temperData = temperStage.data as { reused?: boolean; hammer?: { id: string } } | null;

        const checksCount = backwardsData?.leafResults?.length ?? 0;
        const disprovedCount = backwardsData?.leafResults?.filter(r => r.outcome === 'disproved').length ?? 0;
        const totalAttempts = manyfaceData?.result?.verdicts?.length ?? 0;
        const failedAttempts = manyfaceData?.result?.verdicts?.filter(v => !v.passed).length ?? 0;
        const temperReused = temperData?.reused ?? false;
        const toolId = run.hammerId ?? temperData?.hammer?.id ?? '';

        let plainSentence: string;
        if (run.hammerId) {
          plainSentence = `A verified approach to: "${run.goal}". It passed ${checksCount} check(s); ${failedAttempts} weaker attempt(s) were rejected; approved by you; saved as a reusable tool you can run again.`;
        } else if (run.hammerError) {
          plainSentence = `The run completed but no tool was minted: ${run.hammerError}. The goal was "${run.goal}".`;
        } else {
          plainSentence = `No answer text was produced; this goal only yields a verified plan for: "${run.goal}".`;
        }

        run.resultSummary = {
          goal: run.goal,
          backwards: {
            status: backwardsStage.status,
            checksCount,
            disprovedCount,
          },
          manyface: {
            winnerId: manyfaceData?.result?.winnerId ?? '',
            totalAttempts,
            failedAttempts,
          },
          temper: {
            reused: temperReused,
            toolId,
          },
          plainSentence,
        };

        run.status = 'completed';
        this.saveRun(run);
        this.broadcastState(run);
        return;
      }
    }

    run.currentStage = stageIdx + 1;
    this.saveRun(run);
    this.state.storage.setAlarm(Date.now() + 100);
  }
}