export interface ConfigurationDocumentField {
  key: string;
  required: boolean;
  secret: boolean;
  title: string;
  value: string;
}

interface DocumentLine {
  ending: string;
  text: string;
}

const ASSIGNMENT_PATTERN =
  /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseConfigurationDocument(
  content: string,
  requiredVariables: readonly string[],
): ConfigurationDocumentField[] {
  const requiredKeys = normalizedKeys(requiredVariables);
  const required = new Set(requiredKeys);
  const fields: ConfigurationDocumentField[] = [];
  const fieldIndex = new Map<string, number>();
  const lines = splitDocument(content);

  lines.forEach((line, lineIndex) => {
    const assignment = parseAssignment(line.text);
    if (!assignment) return;
    const previousIndex = fieldIndex.get(assignment.key);
    const title = commentTitle(lines[lineIndex - 1]?.text) || assignment.key;
    const field: ConfigurationDocumentField = {
      key: assignment.key,
      required: required.has(assignment.key),
      secret: isSecretConfigurationKey(assignment.key),
      title,
      value: assignment.value,
    };
    if (previousIndex === undefined) {
      fieldIndex.set(assignment.key, fields.length);
      fields.push(field);
    } else {
      fields[previousIndex] = field;
    }
  });

  requiredKeys.forEach((key) => {
    if (fieldIndex.has(key)) return;
    fields.push({
      key,
      required: true,
      secret: isSecretConfigurationKey(key),
      title: key,
      value: "",
    });
  });
  return fields;
}

export function updateConfigurationDocument(
  content: string,
  updates: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(updates).filter(([key]) =>
    KEY_PATTERN.test(key),
  );
  if (entries.length === 0) return content;

  const lines = splitDocument(content);
  const assignmentIndexes = new Map<string, number>();
  lines.forEach((line, index) => {
    const assignment = parseAssignment(line.text);
    if (assignment) assignmentIndexes.set(assignment.key, index);
  });

  const additions: Array<[string, string]> = [];
  entries.forEach(([key, value]) => {
    const index = assignmentIndexes.get(key);
    if (index === undefined) {
      additions.push([key, value]);
      return;
    }
    const assignment = parseAssignment(lines[index].text);
    if (assignment && assignment.value !== value) {
      lines[index].text = `${assignment.prefix}${value}`;
    }
  });
  appendAssignments(lines, additions);
  return lines.map((line) => `${line.text}${line.ending}`).join("");
}

export function isMissingConfigurationValue(value: string) {
  const normalized = value.trim();
  return normalized === "" || normalized === '""' || normalized === "''";
}

export function isSecretConfigurationKey(key: string) {
  const normalized = key.toUpperCase();
  if (/(^|_)PUBLIC_KEY($|_)/.test(normalized)) return false;
  return /(^|_)(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIALS?|AUTH_KEY|SIGNING_KEY|ENCRYPTION_KEY|KEY)($|_)/.test(
    normalized,
  );
}

function normalizedKeys(keys: readonly string[]) {
  return Array.from(
    new Set(
      keys.map((key) => key.trim()).filter((key) => KEY_PATTERN.test(key)),
    ),
  );
}

function parseAssignment(text: string) {
  const match = ASSIGNMENT_PATTERN.exec(text);
  if (!match) return null;
  return {
    key: match[2],
    prefix: `${match[1]}${match[2]}${match[3]}`,
    value: match[4],
  };
}

function commentTitle(text: string | undefined) {
  if (text === undefined) return null;
  const match = /^\s*#+\s*(.*?)\s*$/.exec(text);
  return match?.[1] || null;
}

function splitDocument(content: string): DocumentLine[] {
  if (!content) return [];
  const lines: DocumentLine[] = [];
  let start = 0;
  const endings = /\r\n|\n|\r/g;
  for (const match of content.matchAll(endings)) {
    const index = match.index;
    lines.push({
      ending: match[0],
      text: content.slice(start, index),
    });
    start = index + match[0].length;
  }
  if (start < content.length) {
    lines.push({ ending: "", text: content.slice(start) });
  }
  return lines;
}

function appendAssignments(
  lines: DocumentLine[],
  additions: ReadonlyArray<readonly [string, string]>,
) {
  if (additions.length === 0) return;
  const newline = lines.find((line) => line.ending)?.ending || "\n";
  const preserveTrailingNewline =
    lines.length > 0 && lines[lines.length - 1].ending !== "";

  additions.forEach(([key, value], index) => {
    const previous = lines[lines.length - 1];
    if (previous && !previous.ending) previous.ending = newline;
    lines.push({
      ending:
        preserveTrailingNewline || index < additions.length - 1 ? newline : "",
      text: `${key}=${value}`,
    });
  });
}
