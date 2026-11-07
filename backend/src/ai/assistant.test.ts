import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASSISTANT_LIMITS, AssistantTurnError, parseAssistantReply, plainText, runAssistantTurn } from "./assistant";
import { assistantCapabilities, assistantSystem, AssistantContext } from "./capabilities";
import { JsonCompletionProvider } from "./provider";
import { StubProvider } from "./stub";

/**
 * These cover the parts that need no database: the reply format, the turn loop,
 * and what a role is allowed to see. The checks that need real rows — another
 * company getting 404, each action's verify refusing what its endpoint refuses
 * — are listed in docs/04-ai-assistant.md as still needing a database harness.
 */

function ctx(overrides: Partial<AssistantContext> = {}): AssistantContext {
  return {
    organizationId: "org-1",
    organizationName: "Acme",
    employeeId: "emp-1",
    memberName: "Asha Rao",
    roles: ["Employee"],
    permissions: [],
    timeZone: "Asia/Kolkata",
    today: "2026-11-07",
    currency: "INR",
    canApprove: false,
    ...overrides,
  };
}

/** A provider that replays a fixed script, so the loop is the thing under test. */
function scripted(replies: string[]): JsonCompletionProvider & { calls: number } {
  return {
    name: "scripted",
    model: "test",
    calls: 0,
    async complete() {
      const text = replies[this.calls] ?? replies[replies.length - 1];
      this.calls++;
      return { text, inputTokens: 1, outputTokens: 2 };
    },
  } as JsonCompletionProvider & { calls: number };
}

describe("parseAssistantReply", () => {
  it("accepts a bare JSON object", () => {
    const reply = parseAssistantReply('{"type":"answer","text":"hi","navigate":null,"action":null}');
    assert.deepEqual(reply, { type: "answer", text: "hi", navigate: null, action: null });
  });

  it("accepts JSON wrapped in a code fence", () => {
    const reply = parseAssistantReply('```json\n{"type":"tool","tool":"company_overview","args":{}}\n```');
    assert.deepEqual(reply, { type: "tool", tool: "company_overview", args: {} });
  });

  it("accepts JSON with prose around it", () => {
    const reply = parseAssistantReply('Sure!\n{"type":"answer","text":"ok","navigate":"home","action":null}\nHope that helps.');
    assert.equal(reply?.type, "answer");
    assert.equal(reply.type === "answer" ? reply.navigate : null, "home");
  });

  it("defaults missing args and blank navigate", () => {
    const reply = parseAssistantReply('{"type":"tool","tool":"my_leave"}');
    assert.deepEqual(reply, { type: "tool", tool: "my_leave", args: {} });
    const answer = parseAssistantReply('{"type":"answer","text":"x","navigate":"   "}');
    assert.equal(answer?.type === "answer" ? answer.navigate : "set", null);
  });

  it("rejects prose, arrays and unknown shapes", () => {
    assert.equal(parseAssistantReply("I cannot do that"), null);
    assert.equal(parseAssistantReply("[1,2,3]"), null);
    assert.equal(parseAssistantReply('{"type":"delete","tool":"x"}'), null);
    assert.equal(parseAssistantReply('{"type":"answer"}'), null);
    assert.equal(parseAssistantReply(""), null);
  });
});

describe("plainText", () => {
  it("strips markup and control characters", () => {
    assert.equal(plainText("<b>hi</b> there"), "hi there");
    assert.equal(plainText("a\u0007b"), "ab");
  });

  it("caps the length", () => {
    assert.equal(plainText("x".repeat(99_999)).length, ASSISTANT_LIMITS.maxAnswerChars);
  });
});

describe("assistantCapabilities", () => {
  it("hides tools an employee's role cannot use", () => {
    const { tools } = assistantCapabilities(ctx());
    assert.ok(tools.some((t) => t.name === "company_overview"));
    assert.ok(!tools.some((t) => t.name === "search_employees"), "search_employees needs employee:read");
    assert.ok(!tools.some((t) => t.name === "payroll_overview"));
  });

  it("gives an HR role the people and payroll tools", () => {
    const { tools } = assistantCapabilities(ctx({ permissions: ["employee:read", "payroll:manage"] }));
    assert.ok(tools.some((t) => t.name === "search_employees"));
    assert.ok(tools.some((t) => t.name === "payroll_overview"));
  });

  it("offers no approval action or tool to someone who decides nothing", () => {
    const { actions, tools } = assistantCapabilities(ctx());
    assert.ok(!actions.some((a) => a.kind.startsWith("decide_")), "a plain employee must not be offered approvals");
    assert.ok(!tools.some((t) => t.name === "pending_approvals"));
  });

  it("offers approvals to a manager", () => {
    const { actions, tools } = assistantCapabilities(ctx({ canApprove: true }));
    assert.ok(actions.some((a) => a.kind === "decide_leave"));
    assert.ok(tools.some((t) => t.name === "pending_approvals"));
  });

  it("drops self-service tools when there is no employee record", () => {
    const { tools, actions } = assistantCapabilities(ctx({ employeeId: null }));
    assert.ok(!tools.some((t) => t.name === "my_leave"));
    assert.ok(!actions.some((a) => a.kind === "apply_leave"));
  });

  it("keeps HR-only actions away from an employee", () => {
    assert.ok(!assistantCapabilities(ctx()).actions.some((a) => a.kind === "create_employee"));
    assert.ok(assistantCapabilities(ctx({ permissions: ["employee:write"] })).actions.some((a) => a.kind === "create_employee"));
  });
});

describe("assistantSystem", () => {
  it("names the company and the member, and lists only what the role may use", () => {
    const system = assistantSystem(ctx({ organizationName: "Acme", memberName: "Asha Rao" }));
    assert.match(system, /Company: Acme/);
    assert.match(system, /Member: Asha Rao/);
    assert.match(system, /- company_overview\(/);
    assert.ok(!system.includes("- search_employees("), "a tool the role lacks must not be advertised");
  });
});

describe("runAssistantTurn", () => {
  const base = {
    system: assistantSystem(ctx()),
    history: [],
    allowedTools: new Set(["company_overview", "my_leave"]),
  };

  it("runs a tool, feeds the result back and answers", async () => {
    const provider = scripted([
      '{"type":"tool","tool":"my_leave","args":{}}',
      '{"type":"answer","text":"You have 8 days left.","navigate":"my_leave","action":null}',
    ]);
    const seen: string[] = [];
    const result = await runAssistantTurn({
      ...base,
      provider,
      question: "how much leave do I have?",
      runTool: async (name) => {
        seen.push(name);
        return { ok: true, result: { remaining: 8 } };
      },
    });

    assert.deepEqual(seen, ["my_leave"]);
    assert.equal(result.answer.text, "You have 8 days left.");
    assert.equal(result.answer.navigate, "my_leave");
    assert.deepEqual(result.toolsUsed, [{ name: "my_leave", ok: true }]);
  });

  it("refuses a tool the role may not use, without running it", async () => {
    const provider = scripted([
      '{"type":"tool","tool":"payroll_overview","args":{}}',
      '{"type":"answer","text":"I can\'t see payroll.","navigate":null,"action":null}',
    ]);
    let ran = false;
    const result = await runAssistantTurn({
      ...base,
      provider,
      question: "show payroll",
      runTool: async () => {
        ran = true;
        return { ok: true, result: {} };
      },
    });

    assert.equal(ran, false, "a tool outside the allow-list must never run");
    assert.deepEqual(result.toolsUsed, [{ name: "payroll_overview", ok: false }]);
  });

  it("corrects one malformed reply, then answers", async () => {
    const provider = scripted(["not json at all", '{"type":"answer","text":"ok","navigate":null,"action":null}']);
    const result = await runAssistantTurn({ ...base, provider, question: "hi", runTool: async () => ({ ok: true, result: {} }) });
    assert.equal(result.answer.text, "ok");
    assert.equal(provider.calls, 2);
  });

  it("gives up after a second malformed reply", async () => {
    const provider = scripted(["nope", "still nope", "nope again"]);
    await assert.rejects(
      () => runAssistantTurn({ ...base, provider, question: "hi", runTool: async () => ({ ok: true, result: {} }) }),
      AssistantTurnError,
    );
    assert.equal(provider.calls, 2, "one correction, then stop");
  });

  it("stops asking for tools at the limit", async () => {
    const provider = scripted(['{"type":"tool","tool":"company_overview","args":{}}']);
    await assert.rejects(
      () => runAssistantTurn({ ...base, provider, question: "loop", runTool: async () => ({ ok: true, result: {} }) }),
      AssistantTurnError,
    );
    assert.ok(provider.calls <= ASSISTANT_LIMITS.maxTools + 2);
  });

  it("passes a tool failure back as data rather than throwing", async () => {
    const provider = scripted([
      '{"type":"tool","tool":"my_leave","args":{}}',
      '{"type":"answer","text":"I could not look that up.","navigate":null,"action":null}',
    ]);
    const result = await runAssistantTurn({
      ...base,
      provider,
      question: "leave?",
      runTool: async () => ({ ok: false, error: "That lookup failed." }),
    });
    assert.deepEqual(result.toolsUsed, [{ name: "my_leave", ok: false }]);
    assert.match(result.answer.text, /could not/);
  });
});

describe("the stub provider", () => {
  it("drives a whole turn without a key or a network", async () => {
    const result = await runAssistantTurn({
      provider: new StubProvider(),
      system: assistantSystem(ctx()),
      history: [],
      question: "what is going on?",
      allowedTools: new Set(["company_overview"]),
      runTool: async () => ({ ok: true, result: { company: "Acme", activeEmployees: 12 } }),
    });
    assert.deepEqual(result.toolsUsed, [{ name: "company_overview", ok: true }]);
    assert.match(result.answer.text, /Acme/);
  });

  it("produces one malformed reply on demand, and recovers", async () => {
    const result = await runAssistantTurn({
      provider: new StubProvider(),
      system: assistantSystem(ctx()),
      history: [],
      question: "::malformed please",
      allowedTools: new Set(["company_overview"]),
      runTool: async () => ({ ok: true, result: {} }),
    });
    assert.equal(result.answer.type, "answer");
  });
});
