const { getCategories, getPublishedPosts, jsonResponse, mapPublicPost } = require('./_supabase');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed.' });
  try {
    const [categories, posts] = await Promise.all([getCategories(), getPublishedPosts()]);
    const categoriesById = new Map(categories.map(category => [String(category.id), category.name]));
    return jsonResponse(200, posts.map(post => mapPublicPost(post, categoriesById)));
  } catch (error) {
    console.error('Netlify posts read failed:', error.message);
    return jsonResponse(500, { error: 'Unable to load posts.' });
  }
};