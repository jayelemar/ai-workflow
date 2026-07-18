# V7 Wrapper Policy

`stages/` is the only executable V7 wrapper directory. Each of its sixteen
files declares `stage`, `codexRequired`, and `zeroTokenCompletesStage`.

LOW and MEDIUM do not create V7 lifecycle reports. Every Codex-backed stage
needs its own exact session ID; V7 never falls back to a latest session.
