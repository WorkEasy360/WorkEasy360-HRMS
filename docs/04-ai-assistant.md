# The HRMS AI assistant

What this product fills in for the shared [AI assistant blueprint](./ai-assistant-blueprint.md): its tools, its actions, its domain rules, and where each piece lives.

The **workspace** here is a **company** — one organization, the only one a signed-in member belongs to. There is no workspace id in the path: the company comes from the member's token, and every query is scoped by `organizationId`.

## Where the code is

| Part | File | Shared or ours |
|---|---|---|
| Providers (Gemini, OpenAI, stub) and `JsonCompletionProvider` | [backend/src/ai/provider.ts](../backend/src/ai/provider.ts), `gemini.ts`, `openai.ts`, `stub.ts`, `config.ts` | shared |
| The turn: `runAssistantTurn`, `parseAssistantReply`, `plainText`, the limits | [backend/src/ai/assistant.ts](../backend/src/ai/assistant.ts) | shared |
| Tool, action and page specs, `assistantCapabilities`, `assistantSystem`, `ASSISTANT_PROMPT` | [backend/src/ai/capabilities.ts](../backend/src/ai/capabilities.ts) | ours |
| Tool runners | [backend/src/modules/assistant/tools.ts](../backend/src/modules/assistant/tools.ts) | ours |
| `parseAction`, `verifyAction`, the proposals | [backend/src/modules/assistant/actions.ts](../backend/src/modules/assistant/actions.ts) | ours |
| The route: membership, allowance, tool runner, link and action resolution, logging | [backend/src/modules/assistant/assistant.routes.ts](../backend/src/modules/assistant/assistant.routes.ts) | ours |
| The daily allowance | [backend/src/ai/usage.ts](../backend/src/ai/usage.ts), table `ai_usage_days` | shared shape |
| The chat window and confirmation card | [frontend/src/components/AssistantPanel.tsx](../frontend/src/components/AssistantPanel.tsx) | ours |
| Styles | `c-fab`, `c-chatbox` and the `c-chat-*` family in [frontend/src/ui/admin.css](../frontend/src/ui/admin.css) | shared |
| The assistant's face | [frontend/src/ui/components/agent-avatar.tsx](../frontend/src/ui/components/agent-avatar.tsx) | shared |

The endpoint is `GET /api/assistant` (is it set up, and what to suggest) and `POST /api/assistant` (ask one question).

## Tools

All read-only, all scoped to the company. Self-service tools additionally only ever read the member's own rows. None of them return phone numbers, addresses, personal email, or anyone else's pay.

| Tool | Who sees it |
|---|---|
| `company_overview` — company, today, the member's role, headline counts | everyone (start here) |
| `my_profile`, `my_leave`, `my_attendance`, `my_timesheets`, `my_expenses`, `my_loans`, `my_payslips`, `my_goals`, `my_onboarding_tasks`, `my_assets` | anyone with an employee record |
| `leave_types`, `hr_guide_search`, `recent_announcements`, `helpdesk_tickets` | everyone |
| `pending_approvals` | approvers only (see below) |
| `search_employees`, `employee_details`, `headcount_report` | `employee:read` |
| `recruitment_overview` | `recruitment:manage` |
| `payroll_overview` | `payroll:manage` |
| `asset_inventory` | `asset:manage` |

`helpdesk_tickets` returns the member's own tickets unless they hold `helpdesk:manage`, which lets them ask for the whole company's.

## Actions

The assistant never writes. It proposes, the member confirms, and the confirm button calls the product's **existing endpoint** — the same one the matching page uses. Each proposal is verified first with the endpoint's own zod schema, imported from the route rather than copied.

| Action | Endpoint | Who |
|---|---|---|
| `apply_leave`, `cancel_leave` | `POST /leave-requests`, `/:id/cancel` | own records |
| `check_in`, `check_out` | `POST /attendance/check-in`, `/check-out` | own records |
| `raise_ticket` | `POST /helpdesk` | own records |
| `log_timesheet` | `POST /timesheets` | own records |
| `submit_expense` | `POST /expenses` | own records |
| `update_goal_progress` | `PATCH /goals/me/:id` | own records |
| `complete_onboarding_task` | `PATCH /onboarding/me/:id` | own records |
| `decide_leave`, `decide_timesheet`, `decide_expense`, `decide_loan` | `POST /<module>/:id/approve` or `/reject` | approvers |
| `publish_announcement` | `POST /announcements` | `announcement:manage` |
| `create_job_posting` | `POST /recruitment/postings` | `recruitment:manage` |
| `move_candidate` | `PATCH /recruitment/candidates/:id` | `recruitment:manage` |
| `create_employee` | `POST /employees` | `employee:write` |

**Approver** means the member holds one of `leave:manage`, `timesheet:manage`, `expense:manage` or `loan:manage`, **or** somebody reports to them. Everyone else is offered no approval action and no `pending_approvals` tool, so the assistant never dangles something it cannot do.

**Deliberately absent**, because they are irreversible, move money, or need files and rich editing: processing a payroll run, changing compensation, marking an expense reimbursed, hiring a candidate (it creates an employee and a login), deleting anything, and uploading documents. For those the assistant explains the steps and links to the page.

**`create_employee` is the sharp one.** It creates a login and emails a welcome link immediately, which cannot be unsent. It is marked `danger`, so the confirm button is red, its effect line says the email goes out, and it refuses an email address that already has an account. It was included deliberately; drop it from `ASSISTANT_ACTIONS` if that trade is not worth it.

## Domain rules the prompt enforces

- Leave, timesheets, expense claims and loans are PENDING until decided; only a pending record can be approved, rejected or cancelled.
- Nobody decides their own request, whatever their role. A manager decides their direct reports; HR decides across the company. This mirrors `assertCanDecide`.
- Approving leave draws down that year's balance, and is refused when the balance is short.
- A member's leave balance, payslips, loans and personal details are their own; the assistant does not read out another person's pay or contact details.
- Attendance is one record per day: check in once, check out once.
- Candidates move APPLIED → SCREENING → INTERVIEW → OFFER, or REJECTED. Hiring is not an action.
- Payroll runs and compensation changes are explained and linked, never proposed.

## Settings

| Setting | Meaning |
|---|---|
| `AI_PROVIDER` | `gemini`, `openai`, `stub` or `disabled`. Unset means **disabled**, and the chat says the assistant isn't set up |
| `AI_MODEL` | Optional. Defaults to `gemini-2.5-flash` or `gpt-4.1-mini` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | Required for a real provider — **the API refuses to start without it** |
| `ASSISTANT_DAILY_LIMIT` | Questions per company per day, default 200 |
| `APP_TIMEZONE` | The company's time zone for "today", default `Asia/Kolkata` |

Limits on one question: 4 tools, 50 seconds, 1,500 output tokens, the last 12 messages of history, a 2,000-character question, and tool results cut at 12,000 characters.

## Safety

- **Company isolation** comes from the token and from every query naming `organizationId`, not from the prompt. A member of another company simply never sees these rows; a proposal naming another company's record is refused as not found.
- **The model cannot write.** It has no write tools, and an action is only a suggestion until the member presses the button — at which point the endpoint re-checks everything.
- **Permissions are re-read per question** from the database rather than trusted from the 15-minute token, so a role change takes effect on the next question.
- **Tool results are data.** They travel inside `<tool_result>` tags and the prompt forbids following instructions found in them.
- **Replies are validated.** One malformed reply gets a correction; a second ends the question. Links outside the role's page list, unknown tools and unknown actions are dropped.
- **Logged:** which tools ran, whether each succeeded, token counts, and the proposal kind. Not the question, not the answer, not the data. Confirmed actions appear in the audit log through their own endpoints.

## Testing

`npm test` in `backend/` runs the suite (Node's test runner through tsx). It covers the reply format, the turn loop, the correction-then-fail path, role filtering, and a whole turn on the stub provider.

The stub takes markers in the question so the paths can be driven by hand: `::tool:<name>` forces a tool, `::action:{…}` proposes that action, `::navigate:<key>` returns a link, and `::malformed` returns prose once.

Verified by hand against the local stack on Gemini (`gemini-2.5-flash`) as well as the stub:

- "How much leave do I have left?" reads `my_leave` and answers with the real balance
- "Book me 21 and 22 December off as casual leave" finds the leave type and proposes `apply_leave` with the real id
- "Check me in for today" proposes `check_in`
- another employee's salary, and an attempt to reach other companies, are both declined

One thing that took finding: a model will reach for an **action as if it were a tool**, then report that the tool is missing and give up. The prompt now states that actions are not tools and shows the answer shape, and the turn loop tells it which it is — `unknownTool` in [assistant.ts](../backend/src/ai/assistant.ts) names an action kind when the model asks for one. That moved `check_in` from 0/3 to 3/3. Keep both if you change the prompt.

And with two companies in the database:

- a question runs a tool and answers from real rows
- a proposal carries the endpoint's exact request, and that request succeeds
- proposing the same leave twice is refused with the endpoint's own words
- approving your own request is refused
- the second company cannot see or act on the first company's records
- the allowance returns 429 once it is used up

**Still needs a database harness** (not covered by `npm test`): each action's verify against every refusal its endpoint would give, and the allowance under concurrent questions.
