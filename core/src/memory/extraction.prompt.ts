import type { ChatMessage } from '../llm/llm.client';
import type { MemoryExtractionInput } from './memory-candidate-extractor';

/** Extraction definition version, recorded on every candidate. */
export const EXTRACTION_VERSION = 'memory-extraction-v2';

/** How many prior messages accompany the turn for reference resolution. */
export const EXTRACTION_CONTEXT_WINDOW = 6;

const EXTRACTION_SYSTEM_PROMPT = `You are the memory candidate extractor for ICOS.

Review the supplied conversation turn and identify information that may
be useful to retain as durable knowledge.

Do not extract ordinary conversational filler.

Prefer explicit statements over speculation.

Look for information about:
- the user
- people and relationships
- projects
- work
- skills
- hobbies
- interests
- preferences
- likes and dislikes
- goals
- decisions
- recurring activities
- important context
- persistent facts
- significant events
- facts about ICOS itself
- facts established during the conversation

Do not invent information.

Do not infer sensitive personal attributes unless explicitly stated and
appropriate for the memory system.

Return only structured JSON matching the supplied schema.

A candidate is an observation worth considering for memory, not a final
memory commitment.`;

const RESPONSE_SCHEMA = `Return a JSON array. Each element must have exactly these fields:
- kind: one of fact, preference, person, relationship, project, work, skill, hobby, interest, goal, decision, event, observation
- subject: short noun phrase, e.g. "user", "person:Ada", "project:ICOS"
- predicate: short verb phrase in snake_case, e.g. "prefers", "working_on", "selected"
- object: the claimed value as a short phrase
- confidence: 0 to 1, how certain the statement was made (explicit statements score high, implications low)
- importance: 0 to 1, how likely this matters in the future
- stability: 0 to 1, how likely this stays true over time
- source: "user" when mined from the user message, "assistant" when mined from the assistant response (omit when unclear)

Return [] when nothing in the turn is worth retaining.
Example: [{"kind":"preference","subject":"user","predicate":"prefers","object":"TypeScript","confidence":0.94,"importance":0.72,"stability":0.88}]`;

/**
 * Build the extractor prompt: bounded prior context plus the completed
 * turn. Deliberately small — refine empirically, not speculatively.
 */
export function buildExtractionPrompt(
  input: MemoryExtractionInput,
): ChatMessage[] {
  const context = (input.context ?? []).slice(-EXTRACTION_CONTEXT_WINDOW);
  const contextBlock =
    context.length === 0
      ? '(none)'
      : context.map((m) => `${m.role}: ${m.content}`).join('\n');
  return [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Previous context:\n${contextBlock}`,
        `\nCurrent user message:\n"${input.userMessage.content}"`,
        `\nCurrent assistant response:\n"${input.assistantMessage.content}"`,
        `\nExtract memory candidates from the completed turn.\n\n${RESPONSE_SCHEMA}`,
      ].join('\n'),
    },
  ];
}
