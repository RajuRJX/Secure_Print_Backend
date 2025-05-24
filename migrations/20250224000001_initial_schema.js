exports.up = function(knex) {
  return knex.schema
    .createTable('users', table => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('email').notNullable().unique();
      table.string('password').notNullable();
      table.string('phone_number').notNullable();
      table.boolean('is_cyber_center').defaultTo(false);
      table.string('center_name');
      table.text('center_address');
      table.timestamps(true, true);
    })
    .createTable('documents', table => {
      table.increments('id').primary();
      table.integer('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.integer('cyber_center_id').references('id').inTable('users');
      table.string('file_name').notNullable();
      table.string('s3_key').notNullable();
      table.string('otp').notNullable();
      table.string('status').defaultTo('pending');
      table.timestamps(true, true);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTable('documents')
    .dropTable('users');
}; 