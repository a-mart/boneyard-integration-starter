function encodings(secret: string): string[] {
  const bytes = Buffer.from(secret, "utf8");
  return [secret, bytes.toString("base64"), bytes.toString("base64url"), encodeURIComponent(secret), bytes.toString("hex")];
}

export function containsSecret(text: string, secrets: readonly string[]): boolean {
  return secrets.filter((secret) => secret.length >= 8).some((secret) => encodings(secret).some((form) => text.includes(form)));
}
