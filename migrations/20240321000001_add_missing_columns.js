exports.up = function(knex) {
  return knex.raw(`
    DO $$ 
    BEGIN
      -- Add encryption_key if it doesn't exist
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'documents' AND column_name = 'encryption_key') THEN
        ALTER TABLE documents ADD COLUMN encryption_key BYTEA;
      END IF;

      -- Add cyber_center_id if it doesn't exist
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'documents' AND column_name = 'cyber_center_id') THEN
        ALTER TABLE documents ADD COLUMN cyber_center_id INTEGER;
      END IF;

      -- Add otp if it doesn't exist
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'documents' AND column_name = 'otp') THEN
        ALTER TABLE documents ADD COLUMN otp VARCHAR(255);
      END IF;

      -- Add s3_key if it doesn't exist
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'documents' AND column_name = 's3_key') THEN
        ALTER TABLE documents ADD COLUMN s3_key VARCHAR(255);
      END IF;

      -- Add status if it doesn't exist
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'documents' AND column_name = 'status') THEN
        ALTER TABLE documents ADD COLUMN status VARCHAR(255) DEFAULT 'pending';
      END IF;
    END $$;
  `);
};

exports.down = function(knex) {
  return knex.schema.alterTable('documents', function(table) {
    table.dropColumn('encryption_key');
    table.dropColumn('cyber_center_id');
    table.dropColumn('otp');
    table.dropColumn('s3_key');
    table.dropColumn('status');
  });
}; 