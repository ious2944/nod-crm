import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalObjectStore, InvalidObjectKeyError, isSafeObjectKey } from ".";

const VALID_KEY = "contacts/11111111-2222-4333-8444-555555555555.png";

describe("isSafeObjectKey", () => {
  it("accepte une clé produite par l'application", () => {
    expect(isSafeObjectKey(VALID_KEY)).toBe(true);
  });

  it.each([
    ["remontée de répertoire", "contacts/../../etc/passwd"],
    ["remontée encodée dans le nom", "contacts/..%2fpasswd.png"],
    ["chemin absolu", "/etc/passwd"],
    ["sans dossier", "11111111-2222-4333-8444-555555555555.png"],
    ["trop de segments", "contacts/sub/11111111-2222-4333-8444-555555555555.png"],
    ["octet NUL", "contacts/1111\u0000.png"],
    ["nom arbitraire", "contacts/photo de julien.png"],
    ["sans extension", "contacts/11111111-2222-4333-8444-555555555555"],
  ])("refuse : %s", (_label, key) => {
    expect(isSafeObjectKey(key)).toBe(false);
  });
});

describe("magasin d'objets local", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "nod-store-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("écrit, relit et efface", async () => {
    const store = createLocalObjectStore(root);
    const payload = new Uint8Array([1, 2, 3]);

    await store.put(VALID_KEY, payload);
    expect(await readFile(path.join(root, VALID_KEY))).toEqual(Buffer.from(payload));
    expect(await store.read(VALID_KEY)).toEqual(payload);

    await store.remove(VALID_KEY);
    expect(await store.read(VALID_KEY)).toBeNull();
  });

  it("efface sans se plaindre un objet déjà absent", async () => {
    const store = createLocalObjectStore(root);
    await expect(store.remove(VALID_KEY)).resolves.toBeUndefined();
  });

  it("ne sort jamais de sa racine", async () => {
    const store = createLocalObjectStore(root);

    await expect(store.read("contacts/../../../etc/passwd")).rejects.toThrow(
      InvalidObjectKeyError,
    );
    await expect(store.put("../escape.png", new Uint8Array([0]))).rejects.toThrow(
      InvalidObjectKeyError,
    );
    await expect(store.remove("/etc/passwd")).rejects.toThrow(InvalidObjectKeyError);
  });

  it("n'écrase jamais un objet existant", async () => {
    const store = createLocalObjectStore(root);
    await store.put(VALID_KEY, new Uint8Array([1]));
    await expect(store.put(VALID_KEY, new Uint8Array([2]))).rejects.toThrow();
    await store.remove(VALID_KEY);
  });
});
