// fetch-species-photos.js
// Fetches iNaturalist photo URLs for all species and stores them in Supabase
// Run with: node fetch-species-photos.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getInaturalistPhoto(scientificName) {
  try {
    const res = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&per_page=1`
    );
    const data = await res.json();
    const taxon = data.results?.[0];
    return taxon?.default_photo?.medium_url || null;
  } catch (e) {
    return null;
  }
}

async function fetchAllPhotos() {
  console.log('Fetching species missing photo URLs...');

  const { data: speciesList, error } = await supabase
    .from('species')
    .select('id, scientific_name, common_name')
    .or('image_url.is.null,image_url.eq.');

  if (error) {
    console.error('Error fetching species:', error.message);
    return;
  }

  console.log(`Found ${speciesList.length} species to process.\n`);

  let successCount = 0;
  let failCount = 0;
  let noPhotoCount = 0;

  for (const animal of speciesList) {
    const label = animal.common_name || animal.scientific_name;
    process.stdout.write(`Fetching photo: ${label}...`);

    const photoUrl = await getInaturalistPhoto(animal.scientific_name);

    if (photoUrl) {
      const { error: updateError } = await supabase
        .from('species')
        .update({ image_url: photoUrl })
        .eq('id', animal.id);

      if (updateError) {
        console.log(` FAILED to save`);
        failCount++;
      } else {
        console.log(` Saved`);
        successCount++;
      }
    } else {
      console.log(` No photo found`);
      noPhotoCount++;
    }

    // Respect iNaturalist rate limits
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  console.log(`\nDone. Saved: ${successCount}, No photo: ${noPhotoCount}, Failed: ${failCount}`);
}

fetchAllPhotos();
