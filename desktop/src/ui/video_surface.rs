use dioxus_native::{CustomPaintCtx, CustomPaintSource, DeviceHandle, TextureHandle};
use wgpu::{
    BindGroup, BindGroupDescriptor, BindGroupEntry, BindGroupLayout, BindGroupLayoutDescriptor,
    BindGroupLayoutEntry, BindingResource, BindingType, Buffer, BufferBindingType,
    BufferDescriptor, BufferUsages, Color, ColorTargetState, ColorWrites, CommandEncoderDescriptor,
    Extent3d, FilterMode, FragmentState, MultisampleState, Operations, Origin3d,
    PipelineCompilationOptions, PipelineLayoutDescriptor, PrimitiveState, PrimitiveTopology,
    RenderPassColorAttachment, RenderPassDescriptor, RenderPipeline, RenderPipelineDescriptor,
    Sampler, SamplerBindingType, SamplerDescriptor, ShaderModuleDescriptor, ShaderSource,
    TexelCopyBufferLayout, TexelCopyTextureInfo, TextureAspect, TextureDescriptor,
    TextureDimension, TextureFormat, TextureSampleType, TextureUsages, TextureViewDescriptor,
    TextureViewDimension, VertexState,
};

use crate::playback::VideoFrameReceiver;

const SCALER_WGSL: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct ScaleUniform {
    scale: vec2<f32>,
    offset: vec2<f32>,
};

@group(0) @binding(2)
var<uniform> u_transform: ScaleUniform;

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0)
    );
    var uv = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(pos[in_vertex_index] * u_transform.scale + u_transform.offset, 0.0, 1.0);
    out.uv = uv[in_vertex_index];
    return out;
}

@group(0) @binding(0)
var t_diffuse: texture_2d<f32>;
@group(0) @binding(1)
var s_diffuse: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(t_diffuse, s_diffuse, in.uv);
}
"#;

struct ScalerResources {
    pipeline: RenderPipeline,
    bind_group_layout: BindGroupLayout,
    sampler: Sampler,
    uniform_buffer: Buffer,
}

impl ScalerResources {
    fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("dogmedia-video-scaler-shader"),
            source: ShaderSource::Wgsl(SCALER_WGSL.into()),
        });
        let bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("dogmedia-video-scaler-bgl"),
            entries: &[
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&PipelineLayoutDescriptor {
            label: Some("dogmedia-video-scaler-pl"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&RenderPipelineDescriptor {
            label: Some("dogmedia-video-scaler-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: PipelineCompilationOptions::default(),
            },
            primitive: PrimitiveState {
                topology: PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: MultisampleState::default(),
            fragment: Some(FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(ColorTargetState {
                    format: TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
                compilation_options: PipelineCompilationOptions::default(),
            }),
            multiview: None,
            cache: None,
        });
        let sampler = device.create_sampler(&SamplerDescriptor {
            label: Some("dogmedia-video-scaler-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: FilterMode::Linear,
            min_filter: FilterMode::Linear,
            mipmap_filter: FilterMode::Nearest,
            ..Default::default()
        });
        let uniform_buffer = device.create_buffer(&BufferDescriptor {
            label: Some("dogmedia-video-scaler-uniforms"),
            size: 16,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            pipeline,
            bind_group_layout,
            sampler,
            uniform_buffer,
        }
    }
}

pub struct VideoPaintSource {
    frames: VideoFrameReceiver,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    scaler: Option<ScalerResources>,
    frame_texture: Option<wgpu::Texture>,
    frame_size: Option<(u32, u32)>,
    target_texture: Option<wgpu::Texture>,
    target_texture_handle: Option<TextureHandle>,
    target_size: Option<(u32, u32)>,
    bind_group: Option<BindGroup>,
}

impl VideoPaintSource {
    pub fn new(frames: VideoFrameReceiver) -> Self {
        Self {
            frames,
            device: None,
            queue: None,
            scaler: None,
            frame_texture: None,
            frame_size: None,
            target_texture: None,
            target_texture_handle: None,
            target_size: None,
            bind_group: None,
        }
    }

    fn ensure_placeholder(&mut self, mut ctx: CustomPaintCtx<'_>) -> Option<TextureHandle> {
        if let Some(handle) = &self.target_texture_handle {
            return Some(handle.clone());
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
        let handle = ctx.register_texture(texture.clone());
        self.target_texture_handle = Some(handle.clone());
        self.target_texture = Some(texture);
        self.target_size = Some((1, 1));
        Some(handle)
    }
}

impl CustomPaintSource for VideoPaintSource {
    fn resume(&mut self, device_handle: &DeviceHandle) {
        self.device = Some(device_handle.device.clone());
        self.queue = Some(device_handle.queue.clone());
        self.scaler = None;
        self.bind_group = None;
    }

    fn suspend(&mut self) {
        self.target_texture = None;
        self.target_texture_handle = None;
        self.target_size = None;
        self.frame_texture = None;
        self.frame_size = None;
        self.bind_group = None;
        self.scaler = None;
        self.device = None;
        self.queue = None;
    }

    fn render(
        &mut self,
        mut ctx: CustomPaintCtx<'_>,
        width: u32,
        height: u32,
        _scale: f64,
    ) -> Option<TextureHandle> {
        let dest_w = width.max(1);
        let dest_h = height.max(1);

        let mut frame_updated = false;
        if let Some(frame) = self.frames.take_frame() {
            let expected = frame.width as usize * frame.height as usize * 4;
            if frame.width > 0 && frame.height > 0 && frame.pixels.len() == expected {
                if self.frame_size != Some((frame.width, frame.height)) {
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
                        usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
                        view_formats: &[],
                    });
                    self.frame_texture = Some(texture);
                    self.frame_size = Some((frame.width, frame.height));
                    self.bind_group = None;
                }
                let frame_texture = self.frame_texture.as_ref()?;
                self.queue.as_ref()?.write_texture(
                    TexelCopyTextureInfo {
                        texture: frame_texture,
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
                frame_updated = true;
            }
        }

        let mut target_updated = false;
        if self.target_size != Some((dest_w, dest_h)) {
            if let Some(handle) = self.target_texture_handle.take() {
                ctx.unregister_texture(handle);
            }
            let device = self.device.as_ref()?;
            let texture = device.create_texture(&TextureDescriptor {
                label: Some("dogmedia-video-target"),
                size: Extent3d {
                    width: dest_w,
                    height: dest_h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: TextureDimension::D2,
                format: TextureFormat::Rgba8Unorm,
                usage: TextureUsages::RENDER_ATTACHMENT
                    | TextureUsages::TEXTURE_BINDING
                    | TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            self.target_texture_handle = Some(ctx.register_texture(texture.clone()));
            self.target_texture = Some(texture);
            self.target_size = Some((dest_w, dest_h));
            target_updated = true;
        }

        if self.scaler.is_none()
            && let Some(device) = self.device.as_ref()
        {
            self.scaler = Some(ScalerResources::new(device));
        }

        if (frame_updated || target_updated)
            && let (
                Some(device),
                Some(queue),
                Some(scaler),
                Some(frame_texture),
                Some(target_texture),
                Some((fw, fh)),
            ) = (
                self.device.as_ref(),
                self.queue.as_ref(),
                self.scaler.as_ref(),
                self.frame_texture.as_ref(),
                self.target_texture.as_ref(),
                self.frame_size,
            )
        {
            let fw = fw as f32;
            let fh = fh as f32;
            let tw = dest_w as f32;
            let th = dest_h as f32;
            let scale_factor = (tw / fw).min(th / fh);
            let fit_w = fw * scale_factor;
            let fit_h = fh * scale_factor;
            let scale_x = fit_w / tw;
            let scale_y = fit_h / th;

            let uniforms = [scale_x, scale_y, 0.0_f32, 0.0_f32];
            let mut bytes = [0u8; 16];
            for (i, val) in uniforms.iter().enumerate() {
                bytes[i * 4..i * 4 + 4].copy_from_slice(&val.to_ne_bytes());
            }
            queue.write_buffer(&scaler.uniform_buffer, 0, &bytes);

            if self.bind_group.is_none() {
                let view = frame_texture.create_view(&TextureViewDescriptor::default());
                let bind_group = device.create_bind_group(&BindGroupDescriptor {
                    label: Some("dogmedia-video-scaler-bg"),
                    layout: &scaler.bind_group_layout,
                    entries: &[
                        BindGroupEntry {
                            binding: 0,
                            resource: BindingResource::TextureView(&view),
                        },
                        BindGroupEntry {
                            binding: 1,
                            resource: BindingResource::Sampler(&scaler.sampler),
                        },
                        BindGroupEntry {
                            binding: 2,
                            resource: scaler.uniform_buffer.as_entire_binding(),
                        },
                    ],
                });
                self.bind_group = Some(bind_group);
            }
            let Some(bind_group) = self.bind_group.as_ref() else {
                return self.target_texture_handle.clone();
            };

            let target_view = target_texture.create_view(&TextureViewDescriptor::default());
            let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor {
                label: Some("dogmedia-video-scaler-encoder"),
            });
            {
                let mut pass = encoder.begin_render_pass(&RenderPassDescriptor {
                    label: Some("dogmedia-video-scaler-pass"),
                    color_attachments: &[Some(RenderPassColorAttachment {
                        view: &target_view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: Operations {
                            load: wgpu::LoadOp::Clear(Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
                pass.set_pipeline(&scaler.pipeline);
                pass.set_bind_group(0, bind_group, &[]);
                pass.draw(0..6, 0..1);
            }
            queue.submit(Some(encoder.finish()));
        }

        if self.target_texture_handle.is_none() {
            self.ensure_placeholder(ctx)
        } else {
            self.target_texture_handle.clone()
        }
    }
}
