CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('HOUSEHOLD', 'SCHOOL', 'EXTRACURRICULAR', 'OTHER')),
  duration_minutes integer NULL CHECK (duration_minutes > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED')),
  "order" integer NOT NULL CHECK ("order" > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tasks_order_unique ON tasks ("order");
CREATE INDEX IF NOT EXISTS tasks_pending_order ON tasks ("order") WHERE status = 'PENDING';
