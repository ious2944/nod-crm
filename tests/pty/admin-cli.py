#!/usr/bin/env python3
"""
Validation de `scripts/admin.mjs` dans un VRAI pseudo-terminal.

Pourquoi un PTY et pas un mock de stdin : le bug corrigé par c70f29c ne se
manifestait QUE dans un terminal réel. `readline.createInterface({terminal:true})`
n'appelle pas `input.resume()` ; après le `rl.close()` d'un `ask()` précédent,
stdin restait en pause et l'invite de mot de passe ne recevait jamais rien.
Un `PassThrough` ne reproduit pas ce comportement — c'est précisément pourquoi
le défaut est passé à travers les tests unitaires et n'a été découvert qu'à la
création du premier compte sur un vrai serveur.

    TEST_DATABASE_URL=postgresql://… python3 tests/pty/admin-cli.py

Le script crée un workspace et des comptes jetables dans la base indiquée ; il
n'écrit jamais dans la base de développement ni de production.
"""
import os
import pty
import re
import select
import subprocess
import sys
import time

ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")
DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
PASSWORD = "Mot-De-Passe-PTY-2026!"

if not DATABASE_URL:
    print("TEST_DATABASE_URL est obligatoire (base dédiée).", file=sys.stderr)
    sys.exit(2)


def run(args, answers, timeout=60):
    """Exécute la commande dans un PTY et répond à ses invites."""
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["DATABASE_URL"] = DATABASE_URL
        os.environ["TERM"] = "xterm"
        os.execvp("node", ["node", "scripts/admin.mjs"] + args)

    output, sent, deadline = "", 0, time.time() + timeout
    while time.time() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.4)
        if readable:
            try:
                chunk = os.read(fd, 4096).decode("utf-8", "replace")
            except OSError:
                break
            if not chunk:
                break
            output += chunk
        # Les invites arrivent avec des séquences de positionnement du curseur :
        # il faut les retirer avant de chercher le « : » de fin d'invite.
        if sent < len(answers) and ANSI.sub("", output).rstrip().endswith(":"):
            os.write(fd, (answers[sent] + "\n").encode())
            sent += 1
            time.sleep(0.35)
            output += "\n"

    os.close(fd)
    _, status = os.waitpid(pid, 0)
    return ANSI.sub("", output), os.waitstatus_to_exitcode(status)


results = []
def check(name, condition, detail=""):
    results.append((name, condition))
    print(f"  {'✓' if condition else '✗'} {name}{f' — {detail}' if detail else ''}")


print("Validation de la CLI d'administration dans un pseudo-terminal réel\n")

out, code = run(["create-workspace", "--slug", "pty-ws", "--name", "Workspace PTY"], [])
check("create-workspace", code == 0 and "créé" in out)

# Le scénario exact du bug : une invite ask() suivie d'une invite masquée.
out, code = run(["create-user"], ["pty@example.com", "pty-ws", "Testeur", PASSWORD, PASSWORD])
check("create-user enchaîne ask() puis askSecret() sans blocage", code == 0 and "créé" in out)
check("le mot de passe n'est jamais affiché", PASSWORD not in out)

out, code = run(
    ["create-user", "--email", "pty2@example.com", "--workspace", "pty-ws", "--name", "Deux"],
    [PASSWORD, PASSWORD],
)
check("create-user avec options", code == 0 and "créé" in out)

out, code = run(["reset-password", "--email", "pty@example.com"], [PASSWORD, PASSWORD])
check("reset-password", code == 0 and "remplacé" in out)

out, code = run(
    ["reset-password", "--email", "pty@example.com"],
    ["Divergent-A-2026!", "Divergent-B-2026!", PASSWORD, PASSWORD],
)
check("une confirmation divergente est refusée puis reprise", code == 0 and "diffèrent" in out)

out, code = run(
    ["reset-password", "--email", "pty@example.com"], ["court", PASSWORD, PASSWORD]
)
check("la politique de robustesse est appliquée", "12 caractères" in out)

out, code = run(["disable-user", "--email", "pty2@example.com"], [])
check("disable-user", code == 0 and "désactivé" in out)

out, code = run(["list-users"], [])
check("list-users", code == 0 and "pty@example.com" in out)

out, code = run(["list-workspaces"], [])
check("list-workspaces", code == 0 and "pty-ws" in out)

out, code = run(["commande-inexistante"], [])
check("une commande inconnue échoue proprement", code == 1 and "Commandes disponibles" in out)

# Bout de chaîne : le compte créé doit réellement ouvrir une session.
print("\nLe compte créé permet-il de se connecter à l'application ?")
verification = subprocess.run(
    ["npx", "vitest", "run", "--config", "vitest.integration.config.mts",
     "tests/integration/cli-login.test.ts"],
    env={**os.environ, "CLI_EMAIL": "pty@example.com", "CLI_PASSWORD": PASSWORD},
    capture_output=True,
    text=True,
)
check("le hachage produit par la CLI est accepté par l'application",
      verification.returncode == 0)
if verification.returncode != 0:
    print(verification.stdout[-1500:])

failed = [name for name, ok in results if not ok]
print(f"\n{len(results) - len(failed)} vérification(s) réussie(s), {len(failed)} échec(s).")
sys.exit(1 if failed else 0)
