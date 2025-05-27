exports.up = function(knex) {
  return knex.schema.alterTable('documents', table => {
    table.binary('encryption_key').notNullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('documents', table => {
    table.dropColumn('encryption_key');
  });
}; 