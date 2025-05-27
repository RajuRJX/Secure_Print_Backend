exports.up = function(knex) {
  return knex.schema.alterTable('documents', function(table) {
    // Add encryption_key if it doesn't exist
    if (!table.encryption_key) {
      table.binary('encryption_key');
    }
    // Add other missing columns
    if (!table.cyber_center_id) {
      table.integer('cyber_center_id').unsigned();
    }
    if (!table.otp) {
      table.string('otp');
    }
    if (!table.s3_key) {
      table.string('s3_key');
    }
    if (!table.status) {
      table.string('status').defaultTo('pending');
    }
  });
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