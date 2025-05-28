/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('users', function(table) {
      table.increments('id').primary();
      table.string('email').notNullable().unique();
      table.string('password').notNullable();
      table.boolean('is_cyber_center').defaultTo(false);
      table.string('name');
      table.string('phone_number');
      table.string('center_name');
      table.string('center_address');
      table.timestamps(true, true);
    })
    .createTable('documents', function(table) {
      table.increments('id').primary();
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      table.integer('cyber_center_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
      table.string('file_name').notNullable();
      table.binary('encryption_key').notNullable();
      table.string('s3_key');
      table.string('otp');
      table.timestamp('otp_expires_at');
      table.string('status').defaultTo('pending');
      table.timestamps(true, true);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('documents')
    .dropTableIfExists('users');
};
