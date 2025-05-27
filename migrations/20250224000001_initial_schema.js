exports.up = function(knex) {
  return knex.schema
    .hasTable('users')
    .then(function(exists) {
      if (!exists) {
        return knex.schema.createTable('users', function(table) {
          table.increments('id').primary();
          table.string('email').notNullable().unique();
          table.string('password').notNullable();
          table.timestamps(true, true);
        });
      }
    })
    .then(function() {
      return knex.schema.hasTable('documents');
    })
    .then(function(exists) {
      if (!exists) {
        return knex.schema.createTable('documents', function(table) {
          table.increments('id').primary();
          table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
          table.string('file_name').notNullable();
          table.string('file_path').notNullable();
          table.string('file_type').notNullable();
          table.binary('encryption_key').notNullable();
          table.timestamps(true, true);
        });
      }
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('documents')
    .dropTableIfExists('users');
}; 