exports.up = function(knex) {
  return knex.schema.alterTable('documents', table => {
    table.string('uploaded_by_name');
    table.string('uploaded_by_phone');
    table.string('uploaded_by_email');
    table.dropColumn('user_id'); // Remove user_id since we're not creating users for direct uploads
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('documents', table => {
    table.integer('user_id').references('id').inTable('users');
    table.dropColumn('uploaded_by_name');
    table.dropColumn('uploaded_by_phone');
    table.dropColumn('uploaded_by_email');
  });
}; 