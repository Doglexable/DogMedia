use dioxus_native::{CustomPaintCtx, CustomPaintSource, DeviceHandle, TextureHandle};
use wgpu::{
    Extent3d, Origin3d, TexelCopyBufferLayout, TexelCopyTextureInfo, TextureAspect,
    TextureDescriptor, TextureDimension, TextureFormat, TextureUsages,
};

use crate::playback::{VideoFrame, VideoFrameReceiver};

pub struct VideoPaintSource {
    frames: VideoFrameReceiver,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    texture: Option<wgpu::Texture>,
    texture_handle: Option<TextureHandle>,
    texture_size: Option<(u32, u32)>,
}

impl VideoPaintSource {
    pub fn new(frames: VideoFrameReceiver) -> Self {
        Self {
            frames,
            device: None,
            queue: None,
            texture: None,
            texture_handle: None,
            texture_size: None,
        }
    }

    fn ensure_placeholder(&mut self, mut ctx: CustomPaintCtx<'_>) -> Option<TextureHandle> {
        if self.texture_handle.is_some() {
            return self.texture_handle.clone();
        }
        let device = self.device.as_ref()?;
        let queue = self.queue.as_ref()?;
        let texture = device.create_texture(&TextureDescriptor {
            label: Some("dogmedia-video-placeholder"),
            size: Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            usage: TextureUsages::TEXTURE_BINDING
                | TextureUsages::COPY_DST
                | TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        queue.write_texture(
            TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            &[0, 0, 0, 255],
            TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        self.texture_handle = Some(ctx.register_texture(texture.clone()));
        self.texture = Some(texture);
        self.texture_size = Some((1, 1));
        self.texture_handle.clone()
    }

    fn upload(&mut self, mut ctx: CustomPaintCtx<'_>, frame: VideoFrame) -> Option<TextureHandle> {
        let expected = frame.width as usize * frame.height as usize * 4;
        if frame.width == 0 || frame.height == 0 || frame.pixels.len() != expected {
            return self.texture_handle.clone();
        }
        if self.texture_size != Some((frame.width, frame.height)) {
            if let Some(handle) = self.texture_handle.take() {
                ctx.unregister_texture(handle);
            }
            let device = self.device.as_ref()?;
            let texture = device.create_texture(&TextureDescriptor {
                label: Some("dogmedia-video-frame"),
                size: Extent3d {
                    width: frame.width,
                    height: frame.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: TextureDimension::D2,
                format: TextureFormat::Rgba8Unorm,
                usage: TextureUsages::TEXTURE_BINDING
                    | TextureUsages::COPY_DST
                    | TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            self.texture_handle = Some(ctx.register_texture(texture.clone()));
            self.texture = Some(texture);
            self.texture_size = Some((frame.width, frame.height));
        }
        let texture = self.texture.as_ref()?;
        self.queue.as_ref()?.write_texture(
            TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: Origin3d::ZERO,
                aspect: TextureAspect::All,
            },
            &frame.pixels,
            TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(frame.width * 4),
                rows_per_image: Some(frame.height),
            },
            Extent3d {
                width: frame.width,
                height: frame.height,
                depth_or_array_layers: 1,
            },
        );
        self.texture_handle.clone()
    }
}

impl CustomPaintSource for VideoPaintSource {
    fn resume(&mut self, device_handle: &DeviceHandle) {
        self.device = Some(device_handle.device.clone());
        self.queue = Some(device_handle.queue.clone());
    }

    fn suspend(&mut self) {
        self.texture = None;
        self.texture_handle = None;
        self.texture_size = None;
        self.device = None;
        self.queue = None;
    }

    fn render(
        &mut self,
        ctx: CustomPaintCtx<'_>,
        _width: u32,
        _height: u32,
        _scale: f64,
    ) -> Option<TextureHandle> {
        match self.frames.take_frame() {
            Some(frame) => self.upload(ctx, frame),
            None if self.texture_handle.is_some() => self.texture_handle.clone(),
            None => self.ensure_placeholder(ctx),
        }
    }
}
