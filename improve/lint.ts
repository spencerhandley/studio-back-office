// Mechanical checks on Studio's outgoing texts. The improvement loop reads these alongside its own grading.

const CROSS_DOMAIN: Record<string, RegExp> = {
  musicians: /\bgaller(y|ies)\b|\bconsignment\b/i,
  composers: /\bgaller(y|ies)\b|\bconsignment\b/i,
  tattoo: /\bgaller(y|ies)\b|\broyalt/i,
  photographers: /\broyalt|\bsetlist/i,
};

// The welcome and keyword replies are fixed copy, so they are exempt from the length check.
const FIXED_COPY = /^(Hi, I'm Studio\.|Studio is a back-office agent|Your dashboard:|Reminder:|Check-ins (paused|are back))/;

export function lintReply(text: string, ctx: { onboarding?: boolean; creatorTypes?: string[] } = {}): string[] {
  const issues: string[] = [];
  if (/—/.test(text)) issues.push("em_dash");
  if (/\*\*|^#+\s|^\s*[-*]\s/m.test(text)) issues.push("markdown");
  const body = text.replace(/https?:\/\/\S+/g, "");
  const questions = (body.match(/\?/g) ?? []).length;
  if (questions > 1) issues.push(`multiple_questions(${questions})`);
  if (!FIXED_COPY.test(text)) {
    const limit = ctx.onboarding ? 320 : 480;
    if (body.length > limit) issues.push(`too_long(${body.length}>${limit})`);
  }
  for (const t of ctx.creatorTypes ?? []) {
    const re = CROSS_DOMAIN[t];
    if (re && re.test(text) && !(ctx.creatorTypes ?? []).some((x) => x === "painters" || x === "sculptors")) issues.push(`wrong_domain_terms(${t})`);
  }
  if (/\b(invoic|I'?ll email|I sent|I emailed|I posted|I booked|I paid)/i.test(text)) issues.push("possible_overclaim");
  return issues;
}
