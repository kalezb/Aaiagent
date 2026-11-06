UPDATE contacts
SET his_photo_at = (
  SELECT MAX(h.created_at)
  FROM chat_history h
  WHERE h.token = contacts.token
    AND h.platform = contacts.platform
    AND h.contact_id = contacts.contact_id
    AND h.role = 'user'
    AND (
      TRIM(h.content) = '[图片]'
      OR TRIM(h.content) LIKE '[图片:%]'
      OR TRIM(h.content) = '[闪照]'
      OR TRIM(h.content) = '[对方发的图片]'
      OR TRIM(h.content) LIKE '[对方发的图片:%]'
    )
)
WHERE contacts.his_photo_at = 0
  AND contacts.token IN (
    SELECT token FROM tokens WHERE active_persona_id = 'female_sutang'
  )
  AND EXISTS (
    SELECT 1
    FROM chat_history h
    WHERE h.token = contacts.token
      AND h.platform = contacts.platform
      AND h.contact_id = contacts.contact_id
      AND h.role = 'user'
      AND (
        TRIM(h.content) = '[图片]'
        OR TRIM(h.content) LIKE '[图片:%]'
        OR TRIM(h.content) = '[闪照]'
        OR TRIM(h.content) = '[对方发的图片]'
        OR TRIM(h.content) LIKE '[对方发的图片:%]'
      )
  );
