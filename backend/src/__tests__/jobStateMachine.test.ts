import { JobStatus } from '@prisma/client';
import {
  isTransitionAllowed,
  getAllowedTransitions,
} from '../services/jobStateMachine';

// Tests cover the pure, DB-free functions only.
// applyTransition() requires a real DB and belongs in integration tests.

describe('isTransitionAllowed', () => {
  // ── Valid transitions ────────────────────────────────────────────────────────
  describe('valid transitions', () => {
    it('allows TO_BE_CHECKED → CHECKED', () => {
      expect(isTransitionAllowed(JobStatus.TO_BE_CHECKED, JobStatus.CHECKED)).toBe(true);
    });

    it('allows TO_BE_CHECKED → CANCELLED', () => {
      expect(isTransitionAllowed(JobStatus.TO_BE_CHECKED, JobStatus.CANCELLED)).toBe(true);
    });

    it('allows CHECKED → QUOTED', () => {
      expect(isTransitionAllowed(JobStatus.CHECKED, JobStatus.QUOTED)).toBe(true);
    });

    it('allows CHECKED → CANCELLED', () => {
      expect(isTransitionAllowed(JobStatus.CHECKED, JobStatus.CANCELLED)).toBe(true);
    });

    it('allows QUOTED → AUTHORISED', () => {
      expect(isTransitionAllowed(JobStatus.QUOTED, JobStatus.AUTHORISED)).toBe(true);
    });

    it('allows QUOTED → CANCELLED', () => {
      expect(isTransitionAllowed(JobStatus.QUOTED, JobStatus.CANCELLED)).toBe(true);
    });

    it('allows AUTHORISED → COMPLETED', () => {
      expect(isTransitionAllowed(JobStatus.AUTHORISED, JobStatus.COMPLETED)).toBe(true);
    });

    it('allows AUTHORISED → CANCELLED', () => {
      expect(isTransitionAllowed(JobStatus.AUTHORISED, JobStatus.CANCELLED)).toBe(true);
    });
  });

  // ── Invalid transitions ──────────────────────────────────────────────────────
  describe('invalid transitions — skipping steps', () => {
    it('rejects TO_BE_CHECKED → QUOTED (skips CHECKED)', () => {
      expect(isTransitionAllowed(JobStatus.TO_BE_CHECKED, JobStatus.QUOTED)).toBe(false);
    });

    it('rejects TO_BE_CHECKED → AUTHORISED', () => {
      expect(isTransitionAllowed(JobStatus.TO_BE_CHECKED, JobStatus.AUTHORISED)).toBe(false);
    });

    it('rejects TO_BE_CHECKED → COMPLETED', () => {
      expect(isTransitionAllowed(JobStatus.TO_BE_CHECKED, JobStatus.COMPLETED)).toBe(false);
    });

    it('rejects CHECKED → AUTHORISED (skips QUOTED)', () => {
      expect(isTransitionAllowed(JobStatus.CHECKED, JobStatus.AUTHORISED)).toBe(false);
    });

    it('rejects CHECKED → COMPLETED', () => {
      expect(isTransitionAllowed(JobStatus.CHECKED, JobStatus.COMPLETED)).toBe(false);
    });

    it('rejects QUOTED → COMPLETED (skips AUTHORISED)', () => {
      expect(isTransitionAllowed(JobStatus.QUOTED, JobStatus.COMPLETED)).toBe(false);
    });
  });

  describe('invalid transitions — backwards', () => {
    it('rejects CHECKED → TO_BE_CHECKED', () => {
      expect(isTransitionAllowed(JobStatus.CHECKED, JobStatus.TO_BE_CHECKED)).toBe(false);
    });

    it('rejects QUOTED → CHECKED', () => {
      expect(isTransitionAllowed(JobStatus.QUOTED, JobStatus.CHECKED)).toBe(false);
    });

    it('rejects AUTHORISED → QUOTED', () => {
      expect(isTransitionAllowed(JobStatus.AUTHORISED, JobStatus.QUOTED)).toBe(false);
    });

    it('rejects COMPLETED → AUTHORISED', () => {
      expect(isTransitionAllowed(JobStatus.COMPLETED, JobStatus.AUTHORISED)).toBe(false);
    });
  });

  describe('invalid transitions — terminal states', () => {
    it('rejects any transition from COMPLETED', () => {
      const allStatuses = Object.values(JobStatus);
      allStatuses.forEach((target) => {
        expect(isTransitionAllowed(JobStatus.COMPLETED, target)).toBe(false);
      });
    });

    it('rejects any transition from CANCELLED', () => {
      const allStatuses = Object.values(JobStatus);
      allStatuses.forEach((target) => {
        expect(isTransitionAllowed(JobStatus.CANCELLED, target)).toBe(false);
      });
    });
  });

  describe('invalid transitions — self-loops', () => {
    it('rejects TO_BE_CHECKED → TO_BE_CHECKED', () => {
      expect(isTransitionAllowed(JobStatus.TO_BE_CHECKED, JobStatus.TO_BE_CHECKED)).toBe(false);
    });

    it('rejects CHECKED → CHECKED', () => {
      expect(isTransitionAllowed(JobStatus.CHECKED, JobStatus.CHECKED)).toBe(false);
    });
  });
});

describe('getAllowedTransitions', () => {
  it('returns [CHECKED, CANCELLED] for TO_BE_CHECKED', () => {
    expect(getAllowedTransitions(JobStatus.TO_BE_CHECKED)).toEqual(
      expect.arrayContaining([JobStatus.CHECKED, JobStatus.CANCELLED])
    );
    expect(getAllowedTransitions(JobStatus.TO_BE_CHECKED)).toHaveLength(2);
  });

  it('returns [QUOTED, CANCELLED] for CHECKED', () => {
    expect(getAllowedTransitions(JobStatus.CHECKED)).toEqual(
      expect.arrayContaining([JobStatus.QUOTED, JobStatus.CANCELLED])
    );
    expect(getAllowedTransitions(JobStatus.CHECKED)).toHaveLength(2);
  });

  it('returns [AUTHORISED, CANCELLED] for QUOTED', () => {
    expect(getAllowedTransitions(JobStatus.QUOTED)).toEqual(
      expect.arrayContaining([JobStatus.AUTHORISED, JobStatus.CANCELLED])
    );
    expect(getAllowedTransitions(JobStatus.QUOTED)).toHaveLength(2);
  });

  it('returns [COMPLETED, CANCELLED] for AUTHORISED', () => {
    expect(getAllowedTransitions(JobStatus.AUTHORISED)).toEqual(
      expect.arrayContaining([JobStatus.COMPLETED, JobStatus.CANCELLED])
    );
    expect(getAllowedTransitions(JobStatus.AUTHORISED)).toHaveLength(2);
  });

  it('returns [] for COMPLETED (terminal)', () => {
    expect(getAllowedTransitions(JobStatus.COMPLETED)).toEqual([]);
  });

  it('returns [] for CANCELLED (terminal)', () => {
    expect(getAllowedTransitions(JobStatus.CANCELLED)).toEqual([]);
  });
});
