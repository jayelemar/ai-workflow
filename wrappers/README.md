# Workflow Wrappers

Wrappers are thin input adapters. They name one canonical prompt and collect
only its inputs. The referenced prompt owns stage rules, schemas, validation,
and the final response.

Sequence: read-only intake → explicitly invoked MEDIUM/HIGH spec → Plan mode
that reuses or creates required flow artifacts → explicit execution. Direct
flow-artifact generation remains available as an optional standalone stage.
