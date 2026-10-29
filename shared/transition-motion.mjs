// A motion transition operates on a complete, already transformed project
// canvas. Coordinates are canvas fractions, independent of source dimensions.
export function motionTransitionAt(definition, progress) {
  const { direction, kind, axis = 'x' } = definition;
  const translation = amount => ({ x: axis === 'x' ? amount : 0, y: axis === 'y' ? amount : 0 });
  const outgoing = { weight: 1 }, incoming = { weight: 1, translate: translation(direction * (progress - 1)) };
  if (kind === 'push') outgoing.translate = translation(direction * progress);
  else outgoing.clipRect = { x: direction > 0 ? progress : 0, y: 0, width: 1 - progress, height: 1 };
  return { outgoing, incoming };
}

export function motionTransitionFilters(definition, progress) {
  // Filter clocks have different grammar names. The caller owns the timeline
  // expression and binds the requested clock, rather than replacing raw text.
  if (typeof progress !== 'function') throw new TypeError('空间转场需要按时钟变量生成进度表达式');
  const cropProgress = progress('t');
  if (definition.kind === 'push') {
    // Two fixed-size canvases occupy 2W; cropping this strip moves both sources
    // without evaluating source lookup expressions for every output pixel.
    // Flipping both inputs and the result implements the opposite direction
    // with the same stack primitive, preserving each source's orientation.
    const reverse = definition.direction > 0;
    if (definition.axis === 'y') return {
      outgoingFilter: reverse ? 'vflip' : 'null', incomingFilter: reverse ? 'vflip' : 'null',
      combineFilter: `vstack=inputs=2:shortest=1,crop=w=iw:h=ih/2:x=0:y='oh*(${cropProgress})':exact=1${reverse ? ',vflip' : ''}`,
    };
    return {
      outgoingFilter: reverse ? 'hflip' : 'null', incomingFilter: reverse ? 'hflip' : 'null',
      combineFilter: `hstack=inputs=2:shortest=1,crop=w=iw/2:h=ih:x='ow*(${cropProgress})':y=0:exact=1${reverse ? ',hflip' : ''}`,
    };
  }
  const p = progress('T'), translation = definition.direction > 0 ? `((${cropProgress})-1)` : `(1-(${cropProgress}))`;
  const incoming = definition.direction > 0 ? `lt(X,W*(${p}))` : `gte(X,W*(1-(${p})))`;
  return {
    outgoingFilter: 'null',
    incomingFilter: `pad=iw*3:ih:iw:0:color=black@0,crop=w=iw/3:h=ih:x='ow*(1-${translation})':y=0:exact=1`,
    // Replacement includes alpha: a hole in the moving incoming image exposes
    // the lower project layer, rather than mixing in the outgoing image twice.
    combineFilter: `blend=all_expr='if(${incoming},B,A)':shortest=1`,
  };
}
