# omp-cmux

omp-cmux provides session visibility in cmux. It does not own session or workspace orchestration.

## Language

**Session Visibility**:
An ambient representation of an omp session's current state and outcome, available without focusing that session.
_Avoid_: Session observability, session monitoring

**Session Orchestration**:
The initiation and placement of sessions or commands across terminal surfaces and isolated workspaces. It is outside the omp-cmux product boundary.
_Avoid_: Session management, split management
