// api/drive.js
//
// DRIVE — DriveMetrik's primary business/operations AI assistant.
// POST only. Every request must carry a real Supabase user JWT
// (Authorization: Bearer <token>) issued by Supabase Auth for an
// authenticated shop employee.
//
// SECURITY MODEL:
//   - Never uses the Supabase service-role key. Every database call goes
//     through a client created with the user's own access token, so Postgres
//     RLS (shop_isolation / current_shop_id()) enforces tenant isolation --
//     not application-level filtering.
//   - shop_id is NEVER accepted from the request body -- resolved
//     server-side via current_shop_id().
//
// MINIMAL CONTEXT, BY DESIGN (fixed this pass): earlier drafts sent every
// customer's name/phone/email to Anthropic on every single message. That's
// gone. The default context now contains only aggregate counts and
// non-identifying shop/operational data. A specific customer's details are
// only ever fetched via the search_customers tool, on-demand, scoped to
// exactly what the request needs -- and still through the same RLS-scoped
// client, so cross-shop lookup remains impossible regardless.
//
// API-CAPABILITY ACCURACY (fixed this pass): customers and vehicles have
// real, working production APIs (PATCH support confirmed via direct source
// read). Jobs/estimates/invoices/payments/daily-close do not -- no verified
// production API exists for any of them. DRIVE must not describe these as
// equally unbuildable; they're different gaps with different causes.
//
// READ-ONLY FIRST, BY DESIGN: DRIVE still never directly mutates business
// data in this pass, even for customers/vehicles where an API exists --
// that's deliberately deferred, not implemented here. propose_action
// records intent only.
//
// SUPABASE HELPER: requireUser(req) returns { user, db }, where db is a
// per-request client carrying the authenticated user's JWT.
import { requireUser } from './_lib/supabase.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = 'claude-sonnet-4-5';

const TOOLS = [
  {
    name: 'search_customers',
    description:
      'Look up specific customers by name or phone (partial match). Returns only matching customers -- never the full customer list. Use this ONLY when the user asks about a specific customer by name or similar; do not call it to browse everyone.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Name or phone fragment to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_customer_vehicles',
    description: "Get a specific customer's vehicles, given their customer id (from search_customers). Returns only that customer's vehicles.",
    input_schema: {
      type: 'object',
      properties: { customer_id: { type: 'string' } },
      required: ['customer_id'],
    },
  },
  {
    name: 'propose_action',
    description:
      "Record a consequential action the user wants. Use action_has_api=true for customer/vehicle changes (a real API exists, DRIVE just doesn't execute it in this conversation yet) and action_has_api=false for jobs/estimates/invoices/payments/daily-close (no production API exists for these at all yet). This never performs the action -- it only creates an auditable record of the request.",
    input_schema: {
      type: 'object',
      properties: {
        action_type: { type: 'string', description: "e.g. 'update_customer_phone', 'create_invoice'." },
        explanation: { type: 'string' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        action_has_api: { type: 'boolean', description: 'true for customer/vehicle actions (real API exists), false for jobs/estimates/invoices/payments/daily-close (no API exists).' },
        proposed_action: { type: 'object' },
      },
      required: ['action_type', 'explanation', 'risk_level', 'action_has_api', 'proposed_action'],
    },
  },
];

// Default context: aggregate counts and non-identifying operational data
// only. No customer names, phones, emails, VINs, or addresses here --
// those are only ever fetched on-demand via the tools above.
async function buildDefaultContext(supabase) {
  const context = {};
  const countReads = [
    ['customerCount', 'customers'],
    ['vehicleCount', 'vehicles'],
    ['employeeCount', 'employees'],
    ['jobCount', 'jobs'],
    ['estimateCount', 'estimates'],
    ['invoiceCount', 'invoices'],
    ['paymentCount', 'payments'],
  ];
  for (const [key, table] of countReads) {
    try {
      const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
      context[key] = error ? { error: error.message } : count;
    } catch (err) {
      context[key] = { error: String(err?.message || err) };
    }
  }
  try {
    const { data, error } = await supabase.from('shops').select('name, phone, address, subscription_plan, subscription_status').limit(1).maybeSingle();
    context.shop = error ? { error: error.message } : data;
  } catch (err) {
    context.shop = { error: String(err?.message || err) };
  }
  try {
    const { data, error } = await supabase.from('daily_close').select('business_date, over_short').order('business_date', { ascending: false }).limit(5);
    context.recentDailyClose = error ? { error: error.message } : data;
  } catch (err) {
    context.recentDailyClose = { error: String(err?.message || err) };
  }
  return context;
}

function contextToPromptBlock(context) {
  const lines = [
    'Current DriveMetrik aggregate data for this shop (counts and non-identifying info only -- call search_customers for any specific customer):',
  ];
  for (const [key, value] of Object.entries(context)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'error' in value) {
      lines.push(`- ${key}: UNAVAILABLE (${value.error})`);
    } else if (Array.isArray(value) && value.length === 0) {
      lines.push(`- ${key}: no records yet`);
    } else {
      lines.push(`- ${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are Drive, DriveMetrik's business/operations assistant for an authenticated shop employee.

Rules:
- You are given AGGREGATE counts by default, never a customer directory. If the user asks about a specific customer, call search_customers -- do not guess or assume you already know who's in the system.
- Only state facts present in tool results or the aggregate context. If something shows "no records yet" or a count of 0, say that plainly -- never invent a plausible-sounding record.
- API capability is NOT uniform across features:
  - Customers and vehicles: a real DriveMetrik API exists for viewing and editing these. You don't execute changes yourself in this conversation, but the capability itself is real -- never say this is "impossible" or "not built."
  - Jobs, estimates, invoices, payments, daily close: NO production API exists for any of these yet. If asked to act on one of these, be clear that the capability itself doesn't exist in DriveMetrik yet, not just that you personally aren't doing it.
- For any consequential request, call propose_action with action_has_api set correctly per the distinction above. This records the request -- it never performs it. Tell the user plainly: for action_has_api=true, "DriveMetrik can do this, but I don't make that change directly in this conversation yet -- I've recorded the request." For action_has_api=false, "DriveMetrik doesn't have this capability built yet -- I've recorded the request for when it does."
- Never claim an action succeeded unless you have a real tool result confirming it.`;

async function callAnthropic(messages, system) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 2048, system, messages, tools: TOOLS }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }
  return res.json();
}

const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let user, supabase;
  try {
    ({ user, db: supabase } = await requireUser(req));
  } catch {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI provider is not configured (missing ANTHROPIC_API_KEY).' });
  }

  const { message, conversationId: incomingConversationId } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  const { data: shopId, error: shopIdError } = await supabase.rpc('current_shop_id');
  if (shopIdError || !shopId) {
    return res.status(403).json({ error: 'This user is not linked to an active shop.' });
  }

  const { data: driveAgent, error: agentError } = await supabase.from('agents').select('id').eq('slug', 'drive').maybeSingle();
  if (agentError || !driveAgent) {
    return res.status(500).json({ error: 'Drive agent is not registered in this environment.' });
  }

  let conversationId = incomingConversationId;
  if (conversationId) {
    const { data: existing, error: convErr } = await supabase.from('agent_conversations').select('id').eq('id', conversationId).maybeSingle();
    if (convErr || !existing) return res.status(404).json({ error: 'Conversation not found or not accessible.' });
  } else {
    const { data: created, error: createErr } = await supabase
      .from('agent_conversations').insert({ shop_id: shopId, agent_id: driveAgent.id, user_id: user.id, status: 'processing' }).select('id').single();
    if (createErr) return res.status(500).json({ error: 'Could not create conversation: ' + createErr.message });
    conversationId = created.id;
  }

  const { error: userMsgErr } = await supabase.from('agent_messages').insert({ conversation_id: conversationId, role: 'user', content: message });
  if (userMsgErr) return res.status(500).json({ error: 'Could not store message: ' + userMsgErr.message });

  const defaultContext = await buildDefaultContext(supabase);
  const system = SYSTEM_PROMPT + '\n\n' + contextToPromptBlock(defaultContext);

  let messages = [{ role: 'user', content: message }];
  let aiJson;
  try {
    aiJson = await callAnthropic(messages, system);
  } catch (err) {
    await supabase.from('agent_conversations').update({ status: 'error', error_message: String(err?.message || err) }).eq('id', conversationId);
    return res.status(502).json({ error: 'AI provider request failed.', conversationId });
  }

  // Tool loop: handle search_customers / get_customer_vehicles by actually
  // calling them (RLS-scoped) and feeding results back for a final answer.
  // propose_action is handled separately below, after the loop, since it's
  // terminal (records intent, doesn't need a result fed back for reasoning).
  let loopGuard = 0;
  const rejectedProposals = [];
  const createdAuthorizations = [];

  while (loopGuard < 4) {
    loopGuard++;
    const toolUseBlocks = (aiJson.content || []).filter(b => b.type === 'tool_use');
    const lookupBlocks = toolUseBlocks.filter(b => b.name === 'search_customers' || b.name === 'get_customer_vehicles');
    const proposeBlocks = toolUseBlocks.filter(b => b.name === 'propose_action');

    for (const block of proposeBlocks) {
      const input = block.input || {};
      const valid =
        typeof input.action_type === 'string' && input.action_type.trim() &&
        typeof input.explanation === 'string' && input.explanation.trim() &&
        RISK_LEVELS.has(input.risk_level) &&
        typeof input.action_has_api === 'boolean' &&
        input.proposed_action && typeof input.proposed_action === 'object';

      if (!valid) {
        // Strict validation: a malformed proposal is REJECTED, not silently
        // defaulted into a fake row. No schema change for a 'rejected'
        // status -- we simply never insert, and say so plainly.
        rejectedProposals.push({ reason: 'malformed_tool_input', received: input });
        continue;
      }

      const { data: authRow, error: authErr } = await supabase
        .from('agent_action_authorizations')
        .insert({
          shop_id: shopId,
          agent_id: driveAgent.id,
          user_id: user.id,
          action_type: input.action_type,
          proposed_action: input.proposed_action,
          explanation: input.explanation,
          risk_level: input.risk_level,
          status: 'pending',
          execution_status: input.action_has_api ? 'api_exists_not_wired' : 'no_underlying_api',
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select('id').single();

      if (!authErr && authRow) {
        createdAuthorizations.push(authRow.id);
        await supabase.from('audit_log').insert({
          shop_id: shopId, actor_user_id: user.id, agent_id: driveAgent.id,
          action: 'drive_proposed_action_recorded',
          detail: { authorizationId: authRow.id, actionType: input.action_type, actionHasApi: input.action_has_api },
        });
      } else {
        rejectedProposals.push({ reason: 'db_insert_failed', detail: authErr?.message });
      }
    }

    if (lookupBlocks.length === 0) break; // nothing left needing a round-trip

    const toolResults = [];
    for (const block of lookupBlocks) {
      let resultPayload;
      try {
        if (block.name === 'search_customers') {
          const q = String(block.input?.query || '').trim();
          const { data, error } = await supabase
            .from('customers').select('id, name, phone').or(`name.ilike.%${q}%,phone.ilike.%${q}%`).limit(10);
          resultPayload = error ? { error: error.message } : data;
        } else {
          const { data, error } = await supabase
            .from('vehicles').select('id, year, make, model, vin').eq('owner_id', block.input?.customer_id).limit(20);
          resultPayload = error ? { error: error.message } : data;
        }
      } catch (err) {
        resultPayload = { error: String(err?.message || err) };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultPayload) });
    }

    messages = [...messages, { role: 'assistant', content: aiJson.content }, { role: 'user', content: toolResults }];
    try {
      aiJson = await callAnthropic(messages, system);
    } catch (err) {
      await supabase.from('agent_conversations').update({ status: 'error', error_message: String(err?.message || err) }).eq('id', conversationId);
      return res.status(502).json({ error: 'AI provider request failed.', conversationId });
    }
  }

  const textBlocks = (aiJson.content || []).filter(b => b.type === 'text').map(b => b.text);
  let responseText = textBlocks.join('\n');
  if (!responseText && createdAuthorizations.length) {
    responseText = "I've recorded that request.";
  }
  if (rejectedProposals.length) {
    responseText += (responseText ? '\n\n' : '') + "(Note: one of my internal action requests was malformed and was not recorded -- nothing was lost, but flagging it for the record.)";
  }

  const { error: aiMsgErr } = await supabase
    .from('agent_messages')
    .insert({ conversation_id: conversationId, role: 'assistant', content: responseText, tool_calls: (aiJson.content || []).filter(b => b.type === 'tool_use') || null });
  if (aiMsgErr) return res.status(500).json({ error: 'AI responded but the response could not be stored: ' + aiMsgErr.message });

  await supabase.from('agent_conversations').update({ status: 'idle', updated_at: new Date().toISOString() }).eq('id', conversationId);

  return res.status(200).json({
    conversationId,
    response: responseText,
    actionsRecorded: createdAuthorizations,
    actionsRejected: rejectedProposals.length,
  });
}
