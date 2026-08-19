# ClawAgents Desktop v0.4.33

## Summary

- **Gemini 3.7 Flash** is in the model catalog and is the preferred Gemini default.
- **Gemini tool turns now answer.** Flatten retries no longer dump `[called write_file({…})]` as the chat reply, and an empty STOP after tools is not treated as Done.
- **Illegal `call_id` on function responses is gone**, and that Pydantic error is no longer shown as an API-key failure.
- **Request contents are scrubbed** to the google-genai allow-list before each call, so extra fields cannot abort the turn.

## Install

Download the `ClawAgents Desktop_0.4.33_aarch64.dmg` asset below, open it, and drag ClawAgents Desktop to Applications.
