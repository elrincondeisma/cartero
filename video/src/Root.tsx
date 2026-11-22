import { Composition } from 'remotion'
import { Promo, TOTAL } from './Promo'

export const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} defaultProps={{ lang: 'en' as const }} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
    <Composition id="PromoEs" component={Promo} defaultProps={{ lang: 'es' as const }} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
  </>
)
