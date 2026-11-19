import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  
  defaultSecretPath,
  defaultSettingsPath,
  loadSettings,
  parseSettings,
  readOrCreateSecret,
  SettingsError,
  settingsFilePath,
} from "../src/einstellungen.ts";

const root = path.resolve(tmpdir(), "bruecke-test-root");
const vault = path.join(root, "vault");

function minimal(): Record<string, unknown> {
  return {
    portOberflaeche: 8787,
    portMeldeeingang: 8788,
    vault,
    erlaubteOrdner: [vault],
    claudeBefehl: ["claude"],
    datenordner: path.join(root, "daten"),
    erlaubteHerkunft: "http://127.0.0.1:8787",
  };
}

function rejection(input: unknown): SettingsError {
  try {
    parseSettings(input);
  } catch (error: unknown) {
    if (error instanceof SettingsError) return error;
    throw error;
  }
  throw new Error("parseSettings accepted the input");
}

describe("parseSettings", () => {
  it("fills the defaults when only the required fields are given", () => {
    const settings = parseSettings(minimal());
    expect(settings).toEqual({
      portOberflaeche: 8787,
      portMeldeeingang: 8788,
      vault,
      erlaubteOrdner: [vault],
      claudeBefehl: ["claude"],
      datenordner: path.join(root, "daten"),
      geheimnis: path.join(homedir(), ".config", "repocity_bruecke", "geheimnis"),
      assistenzGeheimnis: path.join(homedir(), ".config", "repocity_bruecke", "assistenz_geheimnis"),
      erlaubteHerkunft: "http://127.0.0.1:8787",
      schwelleVerdichten: 200000,
      claudeMem: "http://127.0.0.1:37777",
      oberflaeche: fileURLToPath(new URL("../../app/dist", import.meta.url)),
      qmdBefehl: ["qmd"],
      openrouterSchluessel: null,
    });
  });

  it("takes the path of the OpenRouter key file when it is given", () => {
    const file = path.join(root, "geheim", "openrouter");
    expect(parseSettings({ ...minimal(), openrouterSchluessel: file }).openrouterSchluessel).toBe(file);
  });

  it.each([["a relative path", "relativ/schluessel"], ["null", null], ["a number", 5]])("rejects openrouterSchluessel as %s", (_case, value) => {
    expect(rejection({ ...minimal(), openrouterSchluessel: value }).field).toBe("openrouterSchluessel");
  });

  it("takes every optional field when it is given", () => {
    const settings = parseSettings({
      ...minimal(),
      geheimnis: path.join(root, "geheim", "geheimnis"),
      schwelleVerdichten: 150000,
      claudeMem: "http://127.0.0.1:40000",
      oberflaeche: path.join(root, "app", "dist"),
    });
    expect(settings.geheimnis).toBe(path.join(root, "geheim", "geheimnis"));
    expect(settings.schwelleVerdichten).toBe(150000);
    expect(settings.claudeMem).toBe("http://127.0.0.1:40000");
    expect(settings.oberflaeche).toBe(path.join(root, "app", "dist"));
  });

  it("takes qmdBefehl as command and arguments", () => {
    const command = ["node", path.join(root, "qmd", "bin", "qmd")];
    expect(parseSettings({ ...minimal(), qmdBefehl: command }).qmdBefehl).toEqual(command);
  });

  it.each([[[]], [["qmd", ""]], ["qmd"], [null]])("rejects qmdBefehl %j", (command) => {
    expect(rejection({ ...minimal(), qmdBefehl: command }).field).toBe("qmdBefehl");
  });

  it.each(["relativ/dist", 5, null])("rejects the interface folder %j", (folder) => {
    const error = rejection({ ...minimal(), oberflaeche: folder });
    expect(error.field).toBe("oberflaeche");
    expect(error.message).toContain("oberflaeche");
  });

  it.each([
    "portOberflaeche",
    "portMeldeeingang",
    "vault",
    "erlaubteOrdner",
    "claudeBefehl",
    "datenordner",
    "erlaubteHerkunft",
  ])("names the missing required field %s", (field) => {
    const input = Object.fromEntries(Object.entries(minimal()).filter(([key]) => key !== field));
    const error = rejection(input);
    expect(error.field).toBe(field);
    expect(error.message).toContain(field);
    expect(error.message).toContain("missing");
  });

  it.each([1, 65535])("accepts port %d", (port) => {
    expect(parseSettings({ ...minimal(), portMeldeeingang: port }).portMeldeeingang).toBe(port);
  });

  it.each([0, 65536, -1, 80.5, "8788", null])("rejects port %s", (port) => {
    const error = rejection({ ...minimal(), portMeldeeingang: port });
    expect(error.field).toBe("portMeldeeingang");
    expect(error.message).toContain("portMeldeeingang");
  });

  it("rejects the same port for the interface and the report inlet", () => {
    const error = rejection({ ...minimal(), portMeldeeingang: 8787 });
    expect(error.field).toBe("portMeldeeingang");
  });

  it.each(["vault", "datenordner", "geheimnis"])("rejects a relative path in %s", (field) => {
    const error = rejection({ ...minimal(), [field]: "relativ/ordner" });
    expect(error.field).toBe(field);
  });

  it.each([[[]], [["relativ"]], ["nicht-als-liste"], [[vault, 3]]])("rejects erlaubteOrdner %j", (folders) => {
    expect(rejection({ ...minimal(), erlaubteOrdner: folders }).field).toBe("erlaubteOrdner");
  });

  it("normalises absolute paths", () => {
    const settings = parseSettings({ ...minimal(), datenordner: path.join(root, "a", "..", "daten") });
    expect(settings.datenordner).toBe(path.join(root, "daten"));
  });

  it.each(["geheimnis", "assistenzGeheimnis", "datenordner"])("rejects %s inside the vault", (field) => {
    expect(rejection({ ...minimal(), [field]: path.join(vault, "datei") }).field).toBe(field);
  });

  it("accepts the OpenRouter key in the .env of the vault", () => {
    const file = path.join(vault, ".env");
    expect(parseSettings({ ...minimal(), openrouterSchluessel: file }).openrouterSchluessel).toBe(file);
  });

  it("takes claudeBefehl as command and arguments", () => {
    const command = ["node", path.join(root, "ersatz.mjs"), "--leise"];
    expect(parseSettings({ ...minimal(), claudeBefehl: command }).claudeBefehl).toEqual(command);
  });

  it.each([[""], ["claude"], [7], [[]], [[""]], [["claude", ""]], [["claude", 3]]])("rejects claudeBefehl %j", (command) => {
    const error = rejection({ ...minimal(), claudeBefehl: command });
    expect(error.field).toBe("claudeBefehl");
    expect(error.message).toContain("non-empty list");
  });

  it.each(["http://127.0.0.1:8787", "https://cockpit.example.ts.net"])("accepts the origin %s", (origin) => {
    expect(parseSettings({ ...minimal(), erlaubteHerkunft: origin }).erlaubteHerkunft).toBe(origin);
  });

  it.each(["http://127.0.0.1:8787/", "http://127.0.0.1:8787/kommandozentrale", "127.0.0.1:8787", "ftp://127.0.0.1", "*"])(
    "rejects the origin %s",
    (origin) => {
      expect(rejection({ ...minimal(), erlaubteHerkunft: origin }).field).toBe("erlaubteHerkunft");
    },
  );

  it.each(["file:///etc/passwd", "keine adresse"])("rejects claudeMem %s without http or https", (address) => {
    expect(rejection({ ...minimal(), claudeMem: address }).field).toBe("claudeMem");
  });

  it.each(["supabaseUrl", "supabaseSchluessel", "passwortdatei"])("no longer accepts the removed field %s and asks to remove it", (field) => {
    expect(rejection({ ...minimal(), [field]: "x" }).message).toBe(`bruecke.json: unknown field "${field}"; remove it or correct its name`);
  });

  it.each(["geheimnis", "schwelleVerdichten", "claudeMem"])("rejects null in %s instead of using the default", (field) => {
    expect(rejection({ ...minimal(), [field]: null }).field).toBe(field);
  });

  it.each([10_000, 1_000_000])("accepts the threshold %d, as the interface does", (threshold) => {
    expect(parseSettings({ ...minimal(), schwelleVerdichten: threshold }).schwelleVerdichten).toBe(threshold);
  });

  it.each([9_999, 1_000_001, 0, -5, 150_000.5, "200000"])("rejects the threshold %j", (threshold) => {
    expect(rejection({ ...minimal(), schwelleVerdichten: threshold }).field).toBe("schwelleVerdichten");
  });

  it("names an unknown field instead of ignoring a typo", () => {
    const error = rejection({ ...minimal(), schwelleVerdichen: 100 });
    expect(error.message).toContain("schwelleVerdichen");
  });

  it.each([null, [], "text"])("rejects %j as the whole file", (input) => {
    expect(rejection(input)).toBeInstanceOf(SettingsError);
  });
});

describe("settingsFilePath", () => {
  it("takes the path after --einstellungen before the environment", () => {
    const file = path.join(root, "a.json");
    expect(settingsFilePath(["--einstellungen", file], { BRUECKE_EINSTELLUNGEN: path.join(root, "b.json") })).toBe(file);
  });

  it("takes BRUECKE_EINSTELLUNGEN without an argument", () => {
    const file = path.join(root, "b.json");
    expect(settingsFilePath([], { BRUECKE_EINSTELLUNGEN: file })).toBe(file);
  });

  it("resolves a relative path against the working directory", () => {
    expect(settingsFilePath(["--einstellungen", "bruecke.json"], {})).toBe(path.resolve("bruecke.json"));
  });

  it("takes bruecke.json next to package.json when neither is given, whatever the working directory", () => {
    const besidePackage = fileURLToPath(new URL("../bruecke.json", import.meta.url));
    expect(settingsFilePath([], {})).toBe(besidePackage);
    expect(defaultSettingsPath()).toBe(besidePackage);
  });

  it("rejects --einstellungen without a path and shows a command that works", () => {
    expect(() => settingsFilePath(["--einstellungen"], {})).toThrow(
      `npm start -- --einstellungen "${defaultSettingsPath()}"`,
    );
  });

  it("rejects an empty BRUECKE_EINSTELLUNGEN and names the default file", () => {
    expect(() => settingsFilePath([], { BRUECKE_EINSTELLUNGEN: "" })).toThrow(defaultSettingsPath());
  });
});

describe("files", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(tmpdir(), "bruecke-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("loads a settings file", async () => {
    const file = path.join(folder, "bruecke.json");
    await writeFile(file, JSON.stringify(minimal()));
    expect((await loadSettings(file)).vault).toBe(vault);
  });

  it("reports a missing settings file with its path and the example to copy", async () => {
    const file = path.join(folder, "fehlt.json");
    const failure = loadSettings(file);
    await expect(failure).rejects.toThrow(file);
    await expect(failure).rejects.toThrow("bruecke.beispiel.json");
  });

  it("reports a settings file that is not JSON", async () => {
    const file = path.join(folder, "bruecke.json");
    await writeFile(file, "{ portOberflaeche: 8787 ");
    await expect(loadSettings(file)).rejects.toThrow(/JSON/);
  });

  it("accepts the example file shipped with the bridge", async () => {
    const example = fileURLToPath(new URL("../bruecke.beispiel.json", import.meta.url));
    await expect(loadSettings(example)).resolves.toBeDefined();
  });

  it("creates a missing secret with 32 random bytes and its folder", async () => {
    const file = path.join(folder, "neu", "geheimnis");
    const secret = await readOrCreateSecret(file);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(file, "utf8")).toBe(secret);
    expect(await readOrCreateSecret(path.join(folder, "zweites"))).not.toBe(secret);
  });

  it.skipIf(process.platform === "win32")("creates the secret readable only by its owner", async () => {
    const file = path.join(folder, "geheimnis");
    await readOrCreateSecret(file);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("returns an existing secret unchanged", async () => {
    const file = path.join(folder, "geheimnis");
    await writeFile(file, `${"0a".repeat(32)}\n`, { mode: 0o600 });
    expect(await readOrCreateSecret(file)).toBe("0a".repeat(32));
  });

  it.each(["vorhanden", "0A".repeat(32), "0a".repeat(31), "0a".repeat(33), `${"0a".repeat(31)}0 `])(
    "rejects the secret %j and says it can be deleted",
    async (content) => {
      const file = path.join(folder, "geheimnis");
      await writeFile(file, content);
      const failure = readOrCreateSecret(file);
      await expect(failure).rejects.toThrow(SettingsError);
      await expect(failure).rejects.toThrow(/64 hexadecimal.*delete/);
    },
  );

  it("gives every start the same secret when several create it at the same time", async () => {
    const file = path.join(folder, "neu", "geheimnis");
    const secrets = await Promise.all(Array.from({ length: 5 }, () => readOrCreateSecret(file)));
    expect(new Set(secrets).size).toBe(1);
    expect(await readFile(file, "utf8")).toBe(secrets[0]);
    expect(await readdir(path.dirname(file))).toEqual(["geheimnis"]);
  });

  it.skipIf(process.platform === "win32")("aborts when others may read the secret", async () => {
    const file = path.join(folder, "geheimnis");
    await readOrCreateSecret(file);
    await chmod(file, 0o644);
    await expect(readOrCreateSecret(file)).rejects.toThrow("chmod 600");
  });

  it.skipIf(process.platform === "win32")("aborts when others may enter the folder of the secret", async () => {
    const file = path.join(folder, "privat", "geheimnis");
    await readOrCreateSecret(file);
    await chmod(path.dirname(file), 0o755);
    await expect(readOrCreateSecret(file)).rejects.toThrow("chmod 700");
  });

  it("aborts with the path when the secret cannot be read", async () => {
    const file = path.join(folder, "geheimnis");
    await mkdir(file);
    const failure = readOrCreateSecret(file);
    await expect(failure).rejects.toThrow(SettingsError);
    await expect(failure).rejects.toThrow(file);
  });

  it("aborts when the secret file is empty", async () => {
    const file = path.join(folder, "geheimnis");
    await writeFile(file, "  \n");
    await expect(readOrCreateSecret(file)).rejects.toThrow(/64 hexadecimal/);
  });

  it("puts the default secret under the home folder", () => {
    expect(defaultSecretPath()).toBe(path.join(homedir(), ".config", "repocity_bruecke", "geheimnis"));
  });
});
