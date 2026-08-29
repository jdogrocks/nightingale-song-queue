# Implementation Plan

## Stage 1: Design, contract, scaffold
**Goal**: Verified Nightingale API contract, DESIGN.md, repo scaffold
**Success Criteria**: DESIGN.md facts verified against live instance; repo committed
**Tests**: n/a (manual API probes)
**Status**: Complete

## Stage 2: Backend
**Goal**: Express app, Nightingale client, waitlist store, SSE, tests
**Success Criteria**: `node --test test/` passes; all DESIGN.md companion endpoints implemented
**Tests**: store unit tests; API integration tests against mock Nightingale
**Status**: Not Started

## Stage 3: Frontend
**Goal**: Guest page and VJ page per DESIGN.md
**Success Criteria**: Pages render and operate against the real backend
**Tests**: manual verification in browser (Stage 5)
**Status**: Not Started

## Stage 4: Docker & README
**Goal**: Dockerfile, compose.yaml, README
**Success Criteria**: `docker build` succeeds; README documents setup
**Status**: Not Started

## Stage 5: Integration verification
**Goal**: End-to-end check against live Nightingale at localhost:64448
**Success Criteria**: songbook syncs (422 songs), guest flow works, VJ flow works; tests pass
**Status**: Not Started
