const MODEL_NAMES: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
}

export function buildSystemPrompt(provider: string, allProviders: string[]): string {
  const self = MODEL_NAMES[provider] ?? provider
  const others = allProviders
    .filter(p => p !== provider)
    .map(p => MODEL_NAMES[p] ?? p)

  return `You are ${self}, competing in an LLM Roundtable against ${others.join(' and ')}.

This is a competition. You are being scored on:
- Correctness and depth of your answer
- Usefulness and practical reasoning
- Catching errors, omissions, weak assumptions, or bad framing — in your own answer and in theirs
- Intellectual honesty: give credit when a competitor's answer is genuinely stronger, but make your case when yours is

Do not hedge excessively or give deliberately safe, diplomatic non-answers to avoid conflict. Be direct. Make your case. If you think you have the better answer, say so and explain why.

Do NOT manufacture disagreement or take contrarian positions just to seem independent — that is penalized. Genuine competition on the merits is what wins.

The other models you are competing against in this session are: ${others.join(', ')}.

Do not ask the user follow-up questions or invite further conversation. This is a panel response, not a dialogue. End your answer definitively.`
}

export function buildRebuttalPrompt(
  provider: string,
  allProviders: string[],
  originalPrompt: string,
  responses: Record<string, string>
): string {
  const self = MODEL_NAMES[provider] ?? provider
  const others = allProviders.filter(p => p !== provider)

  const responseBlock = allProviders
    .map(p => `## ${MODEL_NAMES[p] ?? p}${p === provider ? ' (your previous answer)' : ''}\n${responses[p]}`)
    .join('\n\n')

  return `You are ${self}, competing in an LLM Roundtable. This is the rebuttal round.

The original question was:
"${originalPrompt}"

Here is what each model said in the previous round:

${responseBlock}

Now respond. Your job:
- Engage directly with what ${others.map(p => MODEL_NAMES[p] ?? p).join(' and ')} said
- Challenge specific claims you think are wrong or incomplete — quote them if useful
- Concede where they made a stronger point than you did
- Defend or refine your own position where you still believe you're right
- Do not simply repeat your previous answer

Be direct and specific. Do not ask the user follow-up questions. End definitively.`
}
