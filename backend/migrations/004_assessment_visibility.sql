ALTER TABLE assessments
  ADD COLUMN published boolean NOT NULL DEFAULT false,
  ADD COLUMN visibility text NOT NULL DEFAULT 'assigned'
    CHECK (visibility IN ('global', 'company', 'institution', 'assigned'));

CREATE INDEX assessments_candidate_listing_idx ON assessments(published, visibility, available_from, available_until);