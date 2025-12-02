-- Create fire_predictions table for tracking incremental simulation state
-- This table stores predictions for each time step of a fire spread simulation

CREATE TABLE IF NOT EXISTS fire_predictions (
    simulation_id UUID NOT NULL,
    time_step INTEGER NOT NULL,
    block_id TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    spread_probability DOUBLE PRECISION,
    t INTEGER,
    t_burn INTEGER,
    exposure DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (simulation_id, time_step, block_id)
);

-- Create index for fast lookups by simulation and time step
CREATE INDEX IF NOT EXISTS idx_fire_predictions_sim_step 
    ON fire_predictions(simulation_id, time_step);

-- Create index for finding burning cells (t_burn=1)
CREATE INDEX IF NOT EXISTS idx_fire_predictions_burning 
    ON fire_predictions(simulation_id, time_step, t_burn) 
    WHERE t_burn = 1;

-- Create index for querying by block_id across time steps
CREATE INDEX IF NOT EXISTS idx_fire_predictions_block
    ON fire_predictions(simulation_id, block_id, time_step);

-- Add comment explaining the table
COMMENT ON TABLE fire_predictions IS 'Stores fire spread predictions for each time step of a simulation. Each row represents a cell prediction at a specific time step.';
