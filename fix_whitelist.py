import re

path = r"F:\Aaiagent\backend\functions\api\[[route]].ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old = '      const contact = await env.DB.prepare("SELECT is_whitelisted FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?").bind(tokenRow.token, platform, contact_id).first();\n      if (!contact || contact.is_whitelisted === 0) return json({ action: "skip" });'

new = '''      const contact = await env.DB.prepare("SELECT is_whitelisted FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?").bind(tokenRow.token, platform, contact_id).first();
      if (!contact) {
        const nowSec2 = Math.floor(Date.now() / 1000);
        await env.DB.prepare("INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, 1, '', ?)").bind(tokenRow.token, platform, contact_id, contact_name, nowSec2).run();
      } else if (contact.is_whitelisted === 0) {
        return json({ action: "skip" });
      }'''

if old in content:
    content = content.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("OK")
else:
    print("NOT FOUND")
