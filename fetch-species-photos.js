// fetch-species-photos.js
// Fetches iNaturalist photo URLs for all species and stores them in Supabase
// Matches on exact scientific name to avoid wrong species matches
// Run with: node fetch-species-photos.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getInaturalistPhoto(scientificName) {
  try {
    const res = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&rank=species&per_page=10`
    );
    const data = await res.json();
    const results = data.results || [];

    // Only accept a result whose name EXACTLY matches what we searched for
    const exactMatch = results.find(
      (r) => r.name?.toLowerCase().trim() === scientificName.toLowerCase().trim()
    );

    if (exactMatch && exactMatch.default_photo?.medium_url) {
      return exactMatch.default_photo.medium_url;
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function fetchAllPhotos() {
  console.log('Re-fetching ALL species photos with exact name matching...');

  // Re-process every species this time, not just ones missing a photo,
  // since the previous run may have saved wrong photos
  const { data: speciesList, error } = await supabase
    .from('species')
    .select('id, scientific_name, common_name');

  if (error) {
    console.error('Error fetching species:', error.message);
    return;
  }

  console.log(`Found ${speciesList.length} species to process.\n`);

  let successCount = 0;
  let noPhotoCount = 0;
  let failCount = 0;

  for (const animal of speciesList) {
    const label = animal.common_name || animal.scientific_name;
    process.stdout.write(`Fetching photo: ${label}...`);

    const photoUrl = await getInaturalistPhoto(animal.scientific_name);

    const { error: updateError } = await supabase
      .from('species')
      .update({ image_url: photoUrl }) // overwrite with correct value, null if no exact match found
      .eq('id', animal.id);

    if (updateError) {
      console.log(` FAILED to save`);
      failCount++;
    } else if (photoUrl) {
      console.log(` Saved`);
      successCount++;
    } else {
      console.log(` No exact match found`);
      noPhotoCount++;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`\nDone. Saved: ${successCount}, No match: ${noPhotoCount}, Failed: ${failCount}`);
}

fetchAllPhotos();
