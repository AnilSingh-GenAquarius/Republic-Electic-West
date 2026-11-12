/** Republic Electric logo (public/republic-logo.png) on a round white badge so it reads on dark and light backgrounds. */
export default function Logo({ size = 40, title = 'Republic Electric' }) {
  return (
    <span className="sw-logo" style={{ width: size, height: size }}>
      <img src={`${import.meta.env.BASE_URL}republic-logo.png`} alt={title} width={size} height={size} draggable={false} />
    </span>
  )
}
