import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export type TokenVerifier = (authorization: string | undefined) => boolean;

export function createTokenVerifier(token: string): TokenVerifier {
  const expected = sha256(token);
  return (authorization) => {
    const presented = /^Bearer ([^\s]+)$/iu.exec(authorization ?? "")?.[1];
    return presented !== undefined && timingSafeEqual(sha256(presented), expected);
  };
}
