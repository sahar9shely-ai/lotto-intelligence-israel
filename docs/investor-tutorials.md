# Investor tutorials

The investor account has a separate **הדרכה** page with seven short chapters, a
responsive video player, optional Hebrew captions, the written explanation and a
next-chapter action. Manager accounts do not see this page or its navigation.

The feature is disabled by default. `/api/v1/tutorials` returns an empty catalogue
until both `INVESTOR_TUTORIALS_ENABLED=true` and a complete owner-approved package are
present. A partially copied or mismatched package also returns an empty catalogue.
Media is served only after investor authentication; no videos are placed in the
public frontend folder and no access tokens appear in media links. The selected
short lesson downloads to temporary browser Blob URLs, which are revoked when the
chapter/account changes or the page closes. Nothing autoplays.

## Publication package

The current narration was generated under **ElevenLabs Free**. The owner explicitly
requested publication without a paid subscription on 2 October 2026 after being
informed of the provider's commercial-use restriction. This records the owner's
publication decision; it does not establish a commercial voice license. Keep
`commercial_license_confirmed=false` until actual licensing is verified. No
subscription or storage purchase is part of this implementation.

Source material is preserved under
`output/investor-training/voice-redesign/private-review`. Its original private-review
metadata remains historical. The app package has a separate current approval
manifest. Internal WebVTT NOTE blocks are omitted. Provider/publication metadata
stays on the server and is not included in investor catalogue responses.

Each source package has:

```text
publication-approval.json
videos/<lesson-id>.mp4
posters/<lesson-id>.jpg
captions/<lesson-id>.vtt
transcripts/<lesson-id>.txt
```

The lesson identifiers are `01-welcome`, `02-plans-savings`, `03-payments`,
`04-offers-signing`, `05-balance-ending`, `06-help-requests`, and `07-closing`.
Captions and transcripts contain only investor-facing text. Do not include provider
instructions, production notes, private customer details or administrator data.

The approval file describes the exact approved assets. Example shape:

```json
{
  "scope": "investor_app",
  "owner_publication_approved": true,
  "approved_on": "2026-10-02",
  "voice_provider": "ElevenLabs",
  "generation_plan": "Free",
  "commercial_license_confirmed": false,
  "lessons": [
    {
      "id": "01-welcome",
      "duration_seconds": 23.4,
      "sha256": {
        "video": "SHA-256 of the exact MP4",
        "poster": "SHA-256 of the exact JPG",
        "captions": "SHA-256 of the exact VTT",
        "transcript": "SHA-256 of the exact TXT"
      }
    }
  ]
}
```

Include all seven entries. `python backend/tools/prepare_tutorial_package.py SOURCE`
performs a read-only preflight. Add `--destination backend/tutorial-media` to stage
into a fresh directory. It writes `manifest.json` last, after all assets pass the
approval hashes, then verifies the copied package against the server validator.
It never overwrites an existing directory or modifies a voice license.

## Existing Render deployment

`INVESTOR_TUTORIALS_MEDIA_DIR` defaults to `/app/tutorial-media`. The existing
Dockerfile copies `backend/` to `/app`, so an explicitly tracked owner-approved
`backend/tutorial-media/` package can ship with the image. The seven
MP4s total about 13 MB. This
avoids needing a new paid persistent disk. If an existing persistent mount is used
instead, point the setting at that verified package directory; do not assume an
ephemeral upload survives the next deployment.

Keep the enable flag off until the approved package is in the deployed image or
mount. Then verify investor login, all seven videos, captions, written text and
mobile navigation. Verify anonymous and manager media access remain denied.

## Checks

`backend/tests/test_investor_tutorials.py` exercises disabled/incomplete/unapproved
packages, corruption, authentication, manager exclusion, maintenance and account
deactivation with synthetic data only. UI verification should also cover chapter
switching, no autoplay, next chapter, readable transcripts and mobile layout.
