import { GalleryCarousel } from '@/components/organisms/GalleryCarousel/GalleryCarousel';
import { HttpTypes } from '@medusajs/types';

export const ProductGallery = ({
  images,
  videoUrl,
}: {
  images: HttpTypes.StoreProduct['images'];
  videoUrl?: string;
}) => {
  if (!images || images.length === 0) return null;
   
  return (
    <div data-testid="product-gallery">
      <GalleryCarousel images={images} />
      {videoUrl ? (
        <video
          controls
          preload="metadata"
          className="mt-3 max-h-[700px] w-full bg-black object-contain"
          data-testid="product-gallery-video"
        >
          <source src={videoUrl} type="video/mp4" />
        </video>
      ) : null}
    </div>
  );
};
