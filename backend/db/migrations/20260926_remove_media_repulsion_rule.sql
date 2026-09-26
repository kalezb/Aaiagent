-- Remove the legacy rule that told every persona to reject voice and sticker messages.
UPDATE personas
SET system_prompt = REPLACE(
  system_prompt,
  '；对方发语音或表情后告知以后别发，你反感。',
  '。'
);
